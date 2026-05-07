import { fetchProgressive } from "./sabr-fetch-interceptor/progressive-fetcher";
import {
  buildSyntheticTemplateFromPlayer,
  buildTemplateFromSabrConfig,
  capturedTemplateToBase64
} from "./sabr-fetch-interceptor/template-builder";
import type { ProgressiveCarryState, ProgressiveFetchResult } from "./sabr-fetch-interceptor/types";
import { patchMediaElementForIframe } from "./sourcebuffer-capture/media-patches";
import { registerGridDropdownHandlers } from "./youtube-main.content/grid/grid-dropdown";
import { registerGridTagger } from "./youtube-main.content/grid/grid-tagger";
import { registerGridVideoDataHandler } from "./youtube-main.content/grid/grid-video-data";
import { setupIframeVideoSilencing } from "./youtube-main.content/iframe-setup";
import { registerMainWorldHandlers } from "./youtube-main.content/main-world-handlers";
import { runTrustFactoryDrive } from "./youtube-main.content/scrub/trust-factory";
import { cancelActiveDownload } from "./youtube-main.content/video/download";
import { extractPlaylistMetadata, handleNavigateSuccess } from "./youtube-main.content/video/playlist-metadata";
import { extractAndDispatchVideoData } from "./youtube-main.content/video/video-data";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { base64ToUint8Array, uint8ToBase64 } from "@/lib/utils/binary";
import { extractInit } from "@/lib/utils/media-init";
import { ScrubUrlParam } from "@/lib/youtube/youtube-url";
import type { DownloadRequest, PlayerResponse } from "@/types";
import { ClientAbrState, VideoPlaybackAbrRequest } from "googlevideo/protos";

declare global {
  interface Window {
    ytInitialPlayerResponse?: PlayerResponse;
    ytInitialData?: {
      header?: {
        playlistHeaderRenderer?: {
          title?: {
            simpleText?: string;
          };
          playlistId?: string;
          ownerText?: {
            runs?: Array<{ text?: string }>;
          };
        };
      };
      metadata?: {
        playlistMetadataRenderer?: {
          title?: string;
        };
      };
    };
  }
}

const GOOGLEVIDEO_HOST_FRAGMENT = "googlevideo.com/videoplayback";

function concatBytes(first: Uint8Array, second: Uint8Array) {
  const out = new Uint8Array(first.byteLength + second.byteLength);
  out.set(first, 0);
  out.set(second, first.byteLength);
  return out;
}

function prependInitIfMissing(bytes: Uint8Array, init: Uint8Array | undefined) {
  if (!init || init.byteLength === 0 || bytes.byteLength === 0) {
    return bytes;
  }

  const checkLen = Math.min(init.byteLength, 16);
  for (let i = 0; i < checkLen; i++) {
    if (bytes[i] !== init[i]) {
      return concatBytes(init, bytes);
    }
  }
  return bytes;
}

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  runAt: "document_start",
  allFrames: true,
  async main() {
    Object.defineProperty(navigator, "webdriver", {
      value: false,
      configurable: false,
      enumerable: true,
      writable: false
    });

    if (import.meta.env.FIREFOX) {
      const originalIsTypeSupported = MediaSource.isTypeSupported.bind(MediaSource);
      MediaSource.isTypeSupported = (type: string) => {
        if (type.includes("av01") || type.includes("av1.")) {
          return false;
        }

        return originalIsTypeSupported(type);
      };
    }

    Object.defineProperty(document, "visibilityState", {
      get() {
        return "visible";
      },
      configurable: true
    });
    Object.defineProperty(document, "hidden", {
      get() {
        return false;
      },
      configurable: true
    });
    document.hasFocus = () => true;

    if (self !== top) {
      Object.defineProperty(window, "frameElement", {
        get() {
          return null;
        },
        configurable: true
      });
    }

    if (self !== top && location.search.includes(`${ScrubUrlParam.Ytdl}=1`)) {
      patchMediaElementForIframe();
    }

    const sbMimeTypes = new WeakMap<SourceBuffer, string>();
    const originalAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype.addSourceBuffer = function (mimeType: string) {
      const sourceBuffer = originalAddSourceBuffer.call(this, mimeType);
      sbMimeTypes.set(sourceBuffer, mimeType);
      return sourceBuffer;
    };

    const originalAppendBuffer = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function (data: BufferSource) {
      try {
        const mime = sbMimeTypes.get(this) ?? "";
        const isVideo = mime.startsWith("video/");
        const isAudio = mime.startsWith("audio/");
        const inits = window.__ytdlSabrInits;
        if ((isVideo && !inits?.video) || (isAudio && !inits?.audio)) {
          let bytes: Uint8Array;
          if (ArrayBuffer.isView(data)) {
            bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          } else {
            bytes = new Uint8Array(data);
          }

          const initBytes = extractInit(bytes, mime);
          if (initBytes && initBytes.byteLength > 0) {
            window.__ytdlSabrInits = {
              ...inits,
              ...(isVideo && {
                video: initBytes
              }),
              ...(isAudio && {
                audio: initBytes
              })
            };
          }
        }
      } catch (_) {
        // never break the player
      }

      return originalAppendBuffer.call(this, data);
    };

    const originalFetch = globalThis.fetch.bind(globalThis);

    globalThis.fetch = async function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
      const url = input instanceof Request ? input.url : String(input);
      const method = input instanceof Request ? input.method : init?.method;
      if (method === "POST" && url.includes(GOOGLEVIDEO_HOST_FRAGMENT)) {
        try {
          const reqClone = input instanceof Request ? input.clone() : new Request(input, init);
          const bodyBuffer = await reqClone.clone().arrayBuffer();
          const bodyBytes = new Uint8Array(bodyBuffer);
          const capturedAt = Date.now();
          const decoded = VideoPlaybackAbrRequest.decode(bodyBytes);
          if (decoded.selectedFormatIds.length > 0) {
            window.__ytdlSabrTemplate = {
              url,
              body: bodyBytes,
              capturedAt
            };
            void crossWorldMessenger.sendMessage(CrossWorldMessage.SabrTemplateCaptured, {
              url,
              bodyBase64: uint8ToBase64(bodyBytes),
              capturedAt
            });
          }
        } catch (_) {
          // never break the player
        }
      }

      return originalFetch(input, init);
    };

    crossWorldMessenger.onMessage(CrossWorldMessage.PullSabrTemplate, () => {
      const template = window.__ytdlSabrTemplate;
      if (!template) {
        return null;
      }

      return capturedTemplateToBase64(template);
    });

    crossWorldMessenger.onMessage(CrossWorldMessage.SynthesizeSabrTemplate, ({ data }) => {
      const synthesized = buildSyntheticTemplateFromPlayer();
      if (!synthesized) {
        return null;
      }

      const decoded = VideoPlaybackAbrRequest.decode(synthesized.body);
      if (!decoded.clientAbrState) {
        decoded.clientAbrState = ClientAbrState.decode(new Uint8Array());
      }

      decoded.clientAbrState.playerTimeMs = String(data.playerTimeMs);
      decoded.playerTimeMs = String(data.playerTimeMs);
      const mutatedBody = VideoPlaybackAbrRequest.encode(decoded).finish();
      return {
        url: synthesized.url,
        bodyBase64: uint8ToBase64(mutatedBody),
        capturedAt: synthesized.capturedAt
      };
    });

    window.__ytdlSabr = {
      isTemplatePresent: () => Boolean(window.__ytdlSabrTemplate),
      fetchProgressive: ({
        targetDurationMs, maxIterations = 80, carryState = null, urlOverride, audioFormat, videoFormat, authorization
      }) => fetchProgressive({
        targetDurationMs,
        maxIterations,
        carryState,
        urlOverride,
        audioFormat,
        videoFormat,
        authorization
      }),
      synthesize: () => buildSyntheticTemplateFromPlayer()
    };

    const STALE_THRESHOLD_MS = 60_000;

    async function refreshStaleTemplate() {
      const SEEK_TIMEOUT_MS = 5_000;
      const template = window.__ytdlSabrTemplate;
      const isStale = !template || Date.now() - template.capturedAt > STALE_THRESHOLD_MS;
      if (!isStale) {
        return;
      }

      // Synthetic template uses the original page-load ustreamer config (VP9-compatible),
      // avoiding the AV1-specific config the player updates during its own streaming session.
      const synthesized = buildSyntheticTemplateFromPlayer();
      if (synthesized) {
        window.__ytdlSabrTemplate = synthesized;
        return;
      }

      const video = document.querySelector<HTMLVideoElement>("video");
      if (!video) {
        return;
      }

      // Seek to get a fresh session URL when synthetic build fails (no player available).
      video.pause();
      const capturedAtBefore = template?.capturedAt ?? 0;
      const seekTarget = video.duration > 20 ? video.duration - 10 : video.currentTime + 30;
      video.currentTime = seekTarget;
      await new Promise<void>(resolve => {
        const deadline = Date.now() + SEEK_TIMEOUT_MS;
        const interval = setInterval(() => {
          const updated = window.__ytdlSabrTemplate;
          if ((updated && updated.capturedAt > capturedAtBefore) || Date.now() >= deadline) {
            clearInterval(interval);
            resolve();
          }
        }, 100);
      });

      // Pair the fresh URL from the seek capture with a new synthetic VP9 body to avoid
      // inheriting the player's AV1-specific ustreamer config from the captured request.
      const freshCapture = window.__ytdlSabrTemplate;
      if (freshCapture && freshCapture.capturedAt > capturedAtBefore) {
        const newSynthesized = buildSyntheticTemplateFromPlayer();
        if (newSynthesized) {
          window.__ytdlSabrTemplate = {
            url: freshCapture.url,
            body: newSynthesized.body,
            capturedAt: freshCapture.capturedAt
          };
        }
      }
    }

    function isUsableTemplate() {
      const template = window.__ytdlSabrTemplate;
      if (!template) {
        return false;
      }

      if (Date.now() - template.capturedAt > STALE_THRESHOLD_MS) {
        return false;
      }

      try {
        const decoded = VideoPlaybackAbrRequest.decode(template.body);
        if (decoded.selectedFormatIds.length < 2) {
          return false;
        }

        const playerFormats = window.ytInitialPlayerResponse?.streamingData?.adaptiveFormats ?? [];
        const templateVideoItag = decoded.preferredVideoFormatIds[0]?.itag ?? decoded.selectedFormatIds[1]?.itag;
        const templateVideoMime = playerFormats.find(fmt => fmt.itag === templateVideoItag)?.mimeType ?? "";
        const isAv1Session = templateVideoMime.includes("av01");
        return !isAv1Session;
      } catch {
        return false;
      }
    }

    const SABR_SEEK_CAPTURE_TIMEOUT_MS = 8_000;

    async function captureRealSabrTemplate(video: HTMLVideoElement, seekTargetSec?: number, staleUrl?: string) {
      const capturedAtBefore = window.__ytdlSabrTemplate?.capturedAt ?? 0;
      const seekTarget = seekTargetSec ?? (video.duration > 20 ? video.duration - 10 : 0);
      video.currentTime = seekTarget;
      // Must play briefly so the player issues a real SABR POST at the seeked
      // position — a paused player never generates new requests.
      video.play().catch(() => {});
      // When waiting for a URL rotation (staleUrl provided), the player must first
      // hit its own sps=3 then call YouTube's API for new credentials — allow 20s.
      const timeoutMs = staleUrl ? 20_000 : SABR_SEEK_CAPTURE_TIMEOUT_MS;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const current = window.__ytdlSabrTemplate;
        if (current && current.capturedAt > capturedAtBefore) {
          if (staleUrl && current.url === staleUrl) {
            // Player issued a POST with the stale rate-limited URL; wait for
            // it to refresh credentials and issue a POST with a fresh URL.
            await new Promise(resolve => setTimeout(resolve, 100));
            continue;
          }

          video.pause();
          return true;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      video.pause();
      return false;
    }

    const IFRAME_TEMPLATE_TIMEOUT_MS = 25_000;

    async function captureFreshTemplateViaIframe(videoId: string, seekSeconds?: number): Promise<boolean> {
      const iframe = document.createElement("iframe");
      iframe.allow = "autoplay";
      iframe.style.cssText = "position:fixed;bottom:0;right:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1;";
      const seekParam = seekSeconds && seekSeconds > 0 ? `&t=${Math.floor(seekSeconds)}` : "";
      iframe.src = `https://www.youtube.com/watch?v=${videoId}&${ScrubUrlParam.Ytdl}=1&autoplay=1${seekParam}`;
      document.body.appendChild(iframe);
      const deadline = Date.now() + IFRAME_TEMPLATE_TIMEOUT_MS;
      try {
        while (Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 300));
          try {
            const iframeTemplate = iframe.contentWindow?.__ytdlSabrTemplate;
            if (iframeTemplate) {
              window.__ytdlSabrTemplate = iframeTemplate;
              return true;
            }
          } catch (_) {
            // Not yet accessible — still loading
          }
        }
        return false;
      } finally {
        iframe.remove();
      }
    }

    async function runProgressiveSabrDownload(data: DownloadRequest) {
      const targetDurationMs = (data.videoDurationSec ?? 0) * 1000;
      if (data.poToken && !window.__ytdlCapturedPoToken) {
        window.__ytdlCapturedPoToken = data.poToken;
      }

      const video = document.querySelector<HTMLVideoElement>("video");
      const wasPlaying = video ? !video.paused : false;
      video?.pause();

      if (data.primerBodyBase64 && data.sabrConfig && !isUsableTemplate()) {
        // Prefer main-page synthesis: its URL is the one the page-load player already
        // validated, avoiding 403s from primer URLs whose ustreamer session was never
        // established. Fall back to the primer only when synthesis is unavailable (e.g.
        // on non-watch pages without a live player).
        const mainSynthesized = buildSyntheticTemplateFromPlayer();
        window.__ytdlSabrTemplate = mainSynthesized ?? {
          url: data.sabrConfig.serverAbrStreamingUrl,
          body: base64ToUint8Array(data.primerBodyBase64),
          capturedAt: Date.now()
        };
      } else if (video && isFinite(video.duration) && video.duration > 0) {
        await captureRealSabrTemplate(video, Math.min(10, video.duration / 4));

        if (!isUsableTemplate()) {
          const synthesized = buildSyntheticTemplateFromPlayer();
          if (synthesized) {
            window.__ytdlSabrTemplate = synthesized;
          } else if (data.sabrConfig && data.audioFormat && data.videoFormat) {
            window.__ytdlSabrTemplate = buildTemplateFromSabrConfig({
              sabrConfig: data.sabrConfig,
              audioFormat: data.audioFormat,
              videoFormat: data.videoFormat,
              poToken: data.poToken
            });
          }

          await refreshStaleTemplate();
        }
      } else {
        if (!isUsableTemplate()) {
          const synthesized = buildSyntheticTemplateFromPlayer();
          if (synthesized) {
            window.__ytdlSabrTemplate = synthesized;
          } else if (data.sabrConfig && data.audioFormat && data.videoFormat) {
            window.__ytdlSabrTemplate = buildTemplateFromSabrConfig({
              sabrConfig: data.sabrConfig,
              audioFormat: data.audioFormat,
              videoFormat: data.videoFormat,
              poToken: data.poToken
            });
          }

          await refreshStaleTemplate();
        }
      }

      const MAX_PROGRESSIVE_RETRIES = 20;
      try {
        let carryState: ProgressiveCarryState | null = null;
        let initialPlayerTimeMs: number | undefined;
        let result: ProgressiveFetchResult;
        let isIncomplete = false;
        let progressiveRetries = 0;
        do {
          result = await fetchProgressive({
            targetDurationMs,
            maxIterations: 200,
            carryState,
            initialPlayerTimeMs,
            audioFormat: data.audioFormat,
            videoFormat: data.videoFormat,
            authorization: data.authorization
          });

          isIncomplete = result.audioCoveredMs < targetDurationMs || result.videoCoveredMs < targetDurationMs;

          if (result.needsTemplateRefresh && isIncomplete) {
            if (progressiveRetries >= MAX_PROGRESSIVE_RETRIES) {
              break;
            }

            progressiveRetries++;
            const coveredMs = Math.min(result.audioCoveredMs, result.videoCoveredMs);
            // Use an iframe starting at coveredMs (via &t=) so the iframe player
            // issues a fresh SABR session (new id=) positioned at coveredMs. The server
            // then delivers from coveredMs onward. captureRealSabrTemplate is skipped
            // here because seeking the main player often captures a rate-limited template.
            const capturedViaIframe = await captureFreshTemplateViaIframe(
              data.videoId,
              coveredMs > 0 ? coveredMs / 1000 : undefined
            );
            if (!capturedViaIframe) {
              const freshSynthesized = buildSyntheticTemplateFromPlayer();
              if (freshSynthesized) {
                window.__ytdlSabrTemplate = freshSynthesized;
              }
            }

            initialPlayerTimeMs = coveredMs;
            // Reset position tracking so the fresh session sends no bufferedRanges.
            // With empty bufferedRanges + playerTimeMs=coveredMs the server delivers
            // from ~coveredMs without hitting its ~70s readahead cap, mirroring how
            // the player behaves after a seek. Carry only segmentBytes so bytes
            // already downloaded are not re-fetched.
            carryState = {
              audioEndMs: 0,
              audioLastSeq: 0,
              audioLastSegDurationMs: 0,
              videoEndMs: 0,
              videoLastSeq: 0,
              videoLastSegDurationMs: 0,
              audioSegmentBytes: result.carryState.audioSegmentBytes,
              videoSegmentBytes: result.carryState.videoSegmentBytes,
              playbackCookieBytes: null,
              sabrContexts: new Map(),
              activeSabrContextTypes: new Set()
            };
          }
        } while (result.needsTemplateRefresh && isIncomplete);

        if (result.isStalled && !result.audioBytes.byteLength && !result.videoBytes.byteLength) {
          throw new Error("SABR progressive fetch stalled with no data");
        }

        const inits = window.__ytdlSabrInits;
        const videoBytes = prependInitIfMissing(result.videoBytes, inits?.video);
        const audioBytes = prependInitIfMissing(result.audioBytes, inits?.audio);
        const audioMimeType = data.audioFormat?.mimeType?.split(";")[0] ?? "audio/mp4";
        const videoMimeType = data.videoFormat?.mimeType?.split(";")[0] ?? "video/mp4";
        void crossWorldMessenger.sendMessage(CrossWorldMessage.StreamData, {
          downloadType: data.type,
          videoId: data.videoId,
          filenameOutput: data.filenameOutput,
          videoData: videoBytes,
          audioData: audioBytes,
          videoMimeType,
          audioMimeType,
          audioLabel: data.primaryAudioLabel ?? "",
          additionalAudioData: [],
          metadata: data.metadata
        });
      } catch (error) {
        void crossWorldMessenger.sendMessage(CrossWorldMessage.StreamError, {
          videoId: data.videoId,
          error: error instanceof Error ? error.message : String(error)
        });
      } finally {
        if (wasPlaying) {
          void video?.play();
        }
      }
    }

    crossWorldMessenger.onMessage(CrossWorldMessage.RunProgressiveSabr, ({ data }) => {
      if (!import.meta.env.FIREFOX) {
        // On Chrome, cross-origin SABR POST from the MAIN world is CORS-blocked.
        // The sabr-fetch-interceptor isolated CS handles RunProgressiveSabr via host_permissions.
        return;
      }

      void runProgressiveSabrDownload(data);
    });

    crossWorldMessenger.onMessage(CrossWorldMessage.FetchAndDownloadCdn, async ({ data }) => {
      const { resolvedVideoUrl: videoUrl, resolvedAudioUrl: audioUrl } = data;
      if (!videoUrl || !audioUrl) {
        if (import.meta.env.FIREFOX) {
          void runProgressiveSabrDownload(data);
        }

        return;
      }

      try {
        const [videoResponse, audioResponse] = await Promise.all([
          originalFetch(videoUrl, { credentials: "include" }),
          originalFetch(audioUrl, { credentials: "include" })
        ]);
        if (!videoResponse.ok || !audioResponse.ok) {
          throw new Error(`CDN fetch failed: video=${videoResponse.status} audio=${audioResponse.status}`);
        }

        const [videoBuffer, audioBuffer] = await Promise.all([
          videoResponse.arrayBuffer(),
          audioResponse.arrayBuffer()
        ]);

        void crossWorldMessenger.sendMessage(CrossWorldMessage.StreamData, {
          downloadType: data.type,
          videoId: data.videoId,
          filenameOutput: data.filenameOutput,
          videoData: new Uint8Array(videoBuffer),
          audioData: new Uint8Array(audioBuffer),
          videoMimeType: data.videoFormat?.mimeType?.split(";")[0] ?? "video/mp4",
          audioMimeType: data.audioFormat?.mimeType?.split(";")[0] ?? "audio/mp4",
          audioLabel: data.primaryAudioLabel ?? "",
          additionalAudioData: [],
          metadata: data.metadata
        });
      } catch (error) {
        console.error("[ytdl:cdn-tab] CDN fetch failed, falling back to progressive SABR:", String(error));
        void runProgressiveSabrDownload(data);
      }
    });

    if (location.search.includes(`${ScrubUrlParam.TrustFactoryMode}=1`)) {
      setupIframeVideoSilencing();
      await runTrustFactoryDrive();
      return;
    }

    if (self !== top && !location.search.includes(`${ScrubUrlParam.Ytdl}=1`)) {
      return;
    }

    if (self !== top) {
      setupIframeVideoSilencing();
    }

    registerMainWorldHandlers();
    registerGridDropdownHandlers();
    registerGridTagger();
    registerGridVideoDataHandler();

    document.addEventListener("yt-navigate-finish", handleNavigateSuccess);

    if (document.readyState === "complete") {
      await extractAndDispatchVideoData(cancelActiveDownload);
      extractPlaylistMetadata();
    } else {
      addEventListener("load", () => {
        void extractAndDispatchVideoData(cancelActiveDownload);
        extractPlaylistMetadata();
      }, { once: true });
    }
  }
});

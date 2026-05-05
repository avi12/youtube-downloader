import { fetchProgressive } from "./sabr-fetch-interceptor/progressive-fetcher";
import {
  buildSyntheticTemplateFromPlayer,
  buildTemplateFromSabrConfig,
  capturedTemplateToBase64
} from "./sabr-fetch-interceptor/template-builder";
import {
  patchIntersectionObserverForScrubFrame,
  patchMediaElementForIframe,
  patchMediaElementForScrubFrame,
  patchVisibilityForScrubFrame
} from "./sourcebuffer-capture/media-patches";
import {
  createCaptureState,
  patchAddSourceBuffer,
  patchAppendBuffer
} from "./sourcebuffer-capture/sourcebuffer-patches";
import { registerGridDropdownHandlers } from "./youtube-main.content/grid/grid-dropdown";
import { registerGridTagger } from "./youtube-main.content/grid/grid-tagger";
import { registerGridVideoDataHandler } from "./youtube-main.content/grid/grid-video-data";
import { setupIframeVideoSilencing } from "./youtube-main.content/iframe-setup";
import { registerMainWorldHandlers } from "./youtube-main.content/main-world-handlers";
import { runScrubSelfDrive, runTrustFactoryDrive } from "./youtube-main.content/scrub/self-drive";
import { cancelActiveDownload } from "./youtube-main.content/video/download";
import { extractPlaylistMetadata, handleNavigateSuccess } from "./youtube-main.content/video/playlist-metadata";
import { extractAndDispatchVideoData } from "./youtube-main.content/video/video-data";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { IframeHostMessageType } from "@/lib/messaging/iframe-host-postmessage";
import { base64ToUint8Array, uint8ToBase64 } from "@/lib/utils/binary";
import { extractInit } from "@/lib/utils/media-init";
import { ScrubUrlParam } from "@/lib/youtube/youtube-url";
import type { PlayerResponse } from "@/types";
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
    Object.defineProperty(Navigator.prototype, "webdriver", {
      get() {
        return false;
      },
      configurable: true
    });

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

    if (self === top || location.search.includes(`${ScrubUrlParam.Ytdl}=1`)) {
      const isScrubFrame = location.search.includes(`${ScrubUrlParam.ScrubMode}=1`);
      const isTopLevelScrubTab = self === top && isScrubFrame;
      if (isScrubFrame) {
        patchMediaElementForScrubFrame();
        patchVisibilityForScrubFrame();
        patchIntersectionObserverForScrubFrame();
      } else if (self !== top || isTopLevelScrubTab) {
        patchMediaElementForIframe();
      }

      const sourceBufferMimeTypes = new WeakMap<SourceBuffer, string>();
      const captureState = createCaptureState(sourceBufferMimeTypes);

      window.__ytdlCapture = captureState;

      patchAddSourceBuffer(captureState, sourceBufferMimeTypes);
      patchAppendBuffer(captureState, sourceBufferMimeTypes, isScrubFrame);
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
        targetDurationMs, maxIterations = 80, carryState = null, urlOverride, audioFormat, videoFormat
      }) => fetchProgressive({
        targetDurationMs,
        maxIterations,
        carryState,
        urlOverride,
        audioFormat,
        videoFormat
      }),
      synthesize: () => buildSyntheticTemplateFromPlayer()
    };

    async function refreshStaleTemplate() {
      const STALE_THRESHOLD_MS = 60_000;
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

      try {
        return VideoPlaybackAbrRequest.decode(template.body).selectedFormatIds.length >= 2;
      } catch {
        return false;
      }
    }

    const SABR_SEEK_CAPTURE_TIMEOUT_MS = 8_000;

    async function captureRealSabrTemplate(video: HTMLVideoElement) {
      const capturedAtBefore = window.__ytdlSabrTemplate?.capturedAt ?? 0;
      const seekTarget = video.duration > 20 ? video.duration - 10 : 0;
      video.currentTime = seekTarget;
      const deadline = Date.now() + SABR_SEEK_CAPTURE_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const current = window.__ytdlSabrTemplate;
        if (current && current.capturedAt > capturedAtBefore) {
          return true;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      return false;
    }

    crossWorldMessenger.onMessage(CrossWorldMessage.RunProgressiveSabr, async ({ data }) => {
      const targetDurationMs = (data.videoDurationSec ?? 0) * 1000;
      if (data.poToken && !window.__ytdlCapturedPoToken) {
        window.__ytdlCapturedPoToken = data.poToken;
      }

      const video = document.querySelector<HTMLVideoElement>("video");
      const wasPlaying = video ? !video.paused : false;
      video?.pause();

      if (data.primerBodyBase64 && data.sabrConfig) {
        window.__ytdlSabrTemplate = {
          url: data.sabrConfig.serverAbrStreamingUrl,
          body: base64ToUint8Array(data.primerBodyBase64),
          capturedAt: Date.now()
        };
      } else if (video && isFinite(video.duration) && video.duration > 0) {
        // Only seek to capture a fresh SABR template when no usable one exists.
        // Seeking overwrites the original page-load template (which covers 0ms+)
        // with a seek-position template; if the original is already usable, skip
        // the seek entirely so fetchProgressive downloads the full video from 0.
        if (!isUsableTemplate()) {
          await captureRealSabrTemplate(video);
        }

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

      try {
        const result = await fetchProgressive({
          targetDurationMs,
          maxIterations: 80,
          carryState: null,
          audioFormat: data.audioFormat,
          videoFormat: data.videoFormat
        });
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
    });

    if (location.search.includes(`${ScrubUrlParam.ScrubMode}=1`)) {
      try {
        if (parent !== self) {
          parent.postMessage({
            type: IframeHostMessageType.ScrubDebug,
            msg: `[ytdl:scrub-tab] MAIN booted url=${location.search.slice(0, 120)}`
          }, "*");
        }
      } catch {
        // best-effort debug log
      }

      setupIframeVideoSilencing();
      await runScrubSelfDrive();
      return;
    }

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

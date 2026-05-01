import { getMoviePlayer } from "./sabr-fetch-interceptor/player-helpers";
import { fetchProgressive } from "./sabr-fetch-interceptor/progressive-fetcher";
import { applyInitCache } from "./sabr-fetch-interceptor/scrub-init-cache";
import { buildSyntheticTemplateFromPlayer, capturedTemplateToBase64 } from "./sabr-fetch-interceptor/template-builder";
import { Browser } from "#imports";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { uint8ToBase64 } from "@/lib/utils/binary";
import { extractInit } from "@/lib/utils/media-init";
import { AD_SHOWING_SELECTOR } from "@/lib/youtube/player-selectors";
import { ClientAbrState, VideoPlaybackAbrRequest } from "googlevideo/protos";

const GOOGLEVIDEO_HOST_FRAGMENT = "googlevideo.com/videoplayback";
const SCRUB_SEGMENT_MSG = "ytdl:scrub-segment";

function postSegmentToHost(
  payload: Record<string, unknown>,
  transferables: Transferable[] = []
) {
  if (parent === self) {
    return;
  }

  try {
    parent.postMessage(payload, "*", transferables);
  } catch {
    // cross-origin postMessage may throw in some contexts
  }
}

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: Browser.scripting.ExecutionWorld.MAIN,
  runAt: "document_start",
  allFrames: true,
  main() {
    // Hook MediaSource.addSourceBuffer + SourceBuffer.appendBuffer to capture init segments
    // (ftyp+moov / EBML header) from the player's own first appends. The SABR server won't
    // re-send the init to our synthetic requests (server tracks session state per-session),
    // so we intercept it here before the player processes the data.
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
              ...(isVideo ? { video: initBytes } : {}),
              ...(isAudio ? { audio: initBytes } : {})
            };
          }
        }
      } catch (_) {
        // never break the player
      }

      return originalAppendBuffer.call(this, data);
    };

    const originalFetch = globalThis.fetch.bind(globalThis);
    const isFactoryFrame = location.search.includes("ytdlTrustFactoryMode=1");

    globalThis.fetch = async function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
      const url = input instanceof Request ? input.url : String(input);
      const method = input instanceof Request ? input.method : init?.method;
      if (method === "POST" && url.includes(GOOGLEVIDEO_HOST_FRAGMENT)) {
        const isAdShowing = !isFactoryFrame && Boolean(document.querySelector(AD_SHOWING_SELECTOR));
        if (!isAdShowing) {
          try {
            const reqClone = input instanceof Request ? input.clone() : new Request(input, init);
            const bodyBuffer = await reqClone.clone().arrayBuffer();
            const bodyBytes = new Uint8Array(bodyBuffer);
            const decoded = VideoPlaybackAbrRequest.decode(bodyBytes);
            if (decoded.selectedFormatIds.length > 0) {
              const capturedAt = Date.now();
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
      hasTemplate: () => Boolean(window.__ytdlSabrTemplate),
      fetchProgressive: ({ targetDurationMs, maxIterations = 80, carryState = null }) => fetchProgressive({
        targetDurationMs,
        maxIterations,
        originalFetch,
        carryState
      }),
      synthesize: () => buildSyntheticTemplateFromPlayer()
    };

    crossWorldMessenger.onMessage(CrossWorldMessage.RunScrubSabr, async ({ data }) => {
      const { videoId, scrubIndex, startSec, windowSec } = data;
      const startMs = startSec * 1000;
      const targetDurationMs = (startSec + windowSec) * 1000;
      console.log(`[ytdl:scrub-sabr] index=${scrubIndex} startSec=${startSec} windowSec=${windowSec}`);
      try {
        const result = await fetchProgressive({
          targetDurationMs,
          maxIterations: 20,
          originalFetch,
          carryState: null,
          initialPlayerTimeMs: startMs > 0 ? startMs : undefined
        });
        console.log(`[ytdl:scrub-sabr] index=${scrubIndex} done audio=${result.audioBytes.byteLength}B video=${result.videoBytes.byteLength}B iter=${result.iterations} stalled=${result.stalled} coveredMs=${result.audioCoveredMs}`);
        const playerResponse = getMoviePlayer()?.getPlayerResponse?.();
        const adaptiveFormats = playerResponse?.streamingData?.adaptiveFormats ?? [];
        // Look up by the itag that SABR actually fetched, not the highest-quality format
        const videoFormat = adaptiveFormats.find(format => format.itag === result.videoItag) ?? null;
        const audioFormat = adaptiveFormats.find(format => format.itag === result.audioItag) ?? null;
        const videoMimeType = videoFormat?.mimeType?.split(";")[0] ?? "";
        const audioMimeType = audioFormat?.mimeType?.split(";")[0] ?? "";
        const { videoBytes, audioBytes } = applyInitCache(
          videoId,
          result.videoBytes,
          result.audioBytes,
          videoMimeType,
          audioMimeType
        );
        void crossWorldMessenger.sendMessage(CrossWorldMessage.IframeScrubSegment, {
          videoId,
          scrubIndex,
          videoBytes,
          audioBytes,
          videoMimeType,
          audioMimeType,
          videoBufferEndSec: result.videoCoveredMs / 1000
        });
        const { byteOffset: vOff, byteLength: vLen, buffer: vBuf } = videoBytes;
        const { byteOffset: aOff, byteLength: aLen, buffer: aBuf } = audioBytes;
        const videoBuffer = vBuf.slice(vOff, vOff + vLen);
        const audioBuffer = aBuf.slice(aOff, aOff + aLen);
        postSegmentToHost({
          type: SCRUB_SEGMENT_MSG,
          videoId,
          scrubIndex,
          videoBuffer,
          audioBuffer,
          videoMimeType,
          audioMimeType,
          videoBufferEndSec: result.videoCoveredMs / 1000
        }, [videoBuffer, audioBuffer]);
      } catch (error) {
        console.error(`[ytdl:scrub-sabr] index=${scrubIndex} failed:`, error);
        const emptyBytes = new Uint8Array();
        void crossWorldMessenger.sendMessage(CrossWorldMessage.IframeScrubSegment, {
          videoId,
          scrubIndex,
          videoBytes: emptyBytes,
          audioBytes: emptyBytes,
          videoMimeType: "",
          audioMimeType: ""
        });
        postSegmentToHost({
          type: SCRUB_SEGMENT_MSG,
          videoId,
          scrubIndex,
          videoBuffer: new ArrayBuffer(0),
          audioBuffer: new ArrayBuffer(0),
          videoMimeType: "",
          audioMimeType: ""
        });
      }
    });

    crossWorldMessenger.onMessage(CrossWorldMessage.RunProgressiveSabr, async ({ data }) => {
      console.log(`[ytdl:sabr-progressive-main] received RunProgressiveSabr videoId=${data.videoId} durationSec=${data.videoDurationSec}`);
      const targetDurationMs = (data.videoDurationSec ?? 0) * 1000;
      try {
        const result = await fetchProgressive({
          targetDurationMs,
          maxIterations: 80,
          originalFetch,
          carryState: null
        });
        console.log(`[ytdl:sabr-progressive-main] fetchProgressive returned audio=${result.audioBytes.byteLength}B video=${result.videoBytes.byteLength}B iter=${result.iterations} stalled=${result.stalled}`);
        const audioMimeType = data.audioFormat?.mimeType?.split(";")[0] ?? "audio/mp4";
        const videoMimeType = data.videoFormat?.mimeType?.split(";")[0] ?? "video/mp4";
        void crossWorldMessenger.sendMessage(CrossWorldMessage.StreamData, {
          downloadType: data.type,
          videoId: data.videoId,
          filenameOutput: data.filenameOutput,
          videoData: result.videoBytes,
          audioData: result.audioBytes,
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
      }
    });
  }
});

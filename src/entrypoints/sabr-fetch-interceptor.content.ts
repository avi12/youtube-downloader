import { fetchProgressive } from "./sabr-fetch-interceptor/progressive-fetcher";
import {
  buildSyntheticTemplateFromPlayer,
  buildTemplateFromSabrConfig,
  capturedTemplateToBase64
} from "./sabr-fetch-interceptor/template-builder";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { base64ToUint8Array, uint8ToBase64 } from "@/lib/utils/binary";
import { extractInit } from "@/lib/utils/media-init";
import { ClientAbrState, VideoPlaybackAbrRequest } from "googlevideo/protos";

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

    crossWorldMessenger.onMessage(CrossWorldMessage.RunProgressiveSabr, async ({ data }) => {
      const targetDurationMs = (data.videoDurationSec ?? 0) * 1000;
      if (data.poToken && !window.__ytdlCapturedPoToken) {
        window.__ytdlCapturedPoToken = data.poToken;
      }

      if (data.primerBodyBase64 && data.sabrConfig) {
        window.__ytdlSabrTemplate = {
          url: data.sabrConfig.serverAbrStreamingUrl,
          body: base64ToUint8Array(data.primerBodyBase64),
          capturedAt: Date.now()
        };
      } else if (!window.__ytdlSabrTemplate && data.sabrConfig && data.audioFormat && data.videoFormat) {
        window.__ytdlSabrTemplate = buildTemplateFromSabrConfig({
          sabrConfig: data.sabrConfig,
          audioFormat: data.audioFormat,
          videoFormat: data.videoFormat,
          poToken: data.poToken
        });
      }

      try {
        const result = await fetchProgressive({
          targetDurationMs,
          maxIterations: 80,
          carryState: null,
          urlOverride: data.sabrConfig?.serverAbrStreamingUrl,
          audioFormat: data.audioFormat,
          videoFormat: data.videoFormat
        });
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
      }
    });
  }
});

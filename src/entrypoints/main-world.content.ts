import { buildSyntheticTemplateFromPlayer, capturedTemplateToBase64 } from "./sabr-fetch-interceptor/template-builder";
import { registerGridDropdownHandlers } from "./youtube-main.content/grid/grid-dropdown";
import { registerGridTagger } from "./youtube-main.content/grid/grid-tagger";
import { registerGridVideoDataHandler } from "./youtube-main.content/grid/grid-video-data";
import { registerMainWorldHandlers } from "./youtube-main.content/main-world-handlers";
import { cancelActiveDownload } from "./youtube-main.content/video/download";
import { extractPlaylistMetadata, handleNavigateSuccess } from "./youtube-main.content/video/playlist-metadata";
import { extractAndDispatchVideoData } from "./youtube-main.content/video/video-data";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { uint8ToBase64 } from "@/lib/utils/binary";
import { extractInit } from "@/lib/utils/media-init";
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

    crossWorldMessenger.onMessage(CrossWorldMessage.FetchAndDownloadCdn, async ({ data }) => {
      const { resolvedVideoUrl: videoUrl, resolvedAudioUrl: audioUrl } = data;
      if (!videoUrl || !audioUrl) {
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
        void crossWorldMessenger.sendMessage(CrossWorldMessage.StreamError, {
          videoId: data.videoId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    if (self !== top) {
      return;
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

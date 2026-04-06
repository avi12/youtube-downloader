/**
 * MAIN world content script - runs in the page's JavaScript context.
 *
 * Responsibilities:
 * 1. Read window.ytInitialPlayerResponse and process streaming URLs
 * 2. Inject a segmented download button group into the action bar using
 *    YouTube's native yt-button-view-model elements so they look identical
 *    to YouTube's own buttons (including tooltips, icons, hover states)
 * 3. Relay data and events to/from the isolated world via crossWorldMessenger
 */

import watchButtonStyles from "./watch-button.css?inline";
import { buildVideoData, extractPlayerResponseFromHtml } from "./youtube-api";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/cross-world-messenger";
import { generatePoToken } from "@/lib/po-token-generator";
import { decryptSignatureCipher } from "@/lib/signature-decryptor";
import {
  interruptedDownloadStore,
  playlistMetadataSignal,
  sabrCredentials,
  SYNC_NAMESPACE,
  SyncKey,
  videoDataStore
} from "@/lib/synced-stores.svelte";
import { getCompatibleFilename, getOutputExtension } from "@/lib/utils";
import {
  type AdaptiveFormatItem,
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  type ButtonViewModelData,
  type DownloadRequest,
  type DownloadType,
  IconName,
  ProgressType,
  type PlayerResponse,
  type ProgressUpdate,
  type VideoData,
  type TpYtIronDropdownElement,
  type YtButtonViewModelElement
} from "@/types";
import { SabrStream } from "googlevideo/sabr-stream";
import { buildSabrFormat } from "googlevideo/utils";

declare global {
  interface Window {
    ytInitialPlayerResponse?: PlayerResponse;
    ytInitialData?: {
      header?: {
        playlistHeaderRenderer?: {
          title?: { simpleText?: string };
          playlistId?: string;
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

declare const ytcfg: { get: (key: string) => unknown } | undefined;

declare global {
  interface HTMLElementTagNameMap {
    "ytd-watch-flexy": HTMLElement & { playerData: PlayerResponse | null };
  }
}

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  async main() {
    // ─── Capture infrastructure (document_start) ────────────────────────
    // Patches fetch() and SourceBuffer.appendBuffer BEFORE YouTube loads.

    // ─── Fetch interception ─────────────────────────────────────────────
    // Captures the SABR streaming URL and PO token from the player's own
    // requests so SabrStream can independently fetch the full video.

    let capturedSabrUrl = "";
    let capturedPoToken = "";
    const originalFetch = globalThis.fetch.bind(globalThis);

    // ─── SabrStream helpers ─────────────────────────────────────────────

    function adaptiveFormatToSabrFormat(format: AdaptiveFormatItem) {
      return buildSabrFormat({
        itag: format.itag,
        lastModified: String(format.lastModified),
        xtags: format.xtags,
        width: format.width,
        height: format.height,
        mimeType: format.mimeType,
        audioQuality: format.audioQuality,
        bitrate: format.bitrate,
        averageBitrate: format.averageBitrate,
        quality: format.quality,
        qualityLabel: format.qualityLabel ?? undefined,
        audioTrackId: format.audioTrack?.id,
        approxDurationMs: format.approxDurationMs,
        contentLength: format.contentLength,
        isDrc: false
      });
    }

    async function collectReadableStream(stream: ReadableStream<Uint8Array>) {
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        chunks.push(value);
        totalBytes += value.byteLength;
      }

      const result = new Uint8Array(totalBytes);
      let writeOffset = 0;
      for (const chunk of chunks) {
        result.set(chunk, writeOffset);
        writeOffset += chunk.byteLength;
      }
      return result;
    }

    // On watch pages, YouTube's Service Worker handles CORS for googlevideo.com.
    // On other pages, use the page's fetch which may get CORS-blocked - SabrStream
    // will fall back to SourceBuffer capture in that case.
    function createSabrStream(sabrConfig: NonNullable<VideoData["sabrConfig"]>) {
      const sabrFormats = sabrConfig.formats.map(adaptiveFormatToSabrFormat);
      const durationMs = parseInt(sabrConfig.formats[0]?.approxDurationMs ?? "0");

      // Wrap fetch to avoid CORS preflight on googlevideo.com.
      // SabrStream sends non-safelisted headers (content-type: application/x-protobuf,
      // accept: application/vnd.yt-ump) which trigger preflight OPTIONS requests.
      // Googlevideo.com doesn't handle OPTIONS, so we rewrite to safelisted values.
      // The server accepts any Content-Type and ignores Accept.
      // Fetch wrapper that tries originalFetch first (goes through YouTube's
      // Service Worker for CORS). If it fails (CORS preflight or network error),
      // retries through the background service worker which has host_permissions.
      async function sabrFetchWithFallback(input: RequestInfo | URL, init?: RequestInit) {
        try {
          return await originalFetch(input, init);
        } catch {
          // CORS preflight failed - relay through background
          const url = input instanceof URL ? input.href : String(input);
          let bodyArray = new Uint8Array(0);
          const rawBody = init?.body;
          if (rawBody instanceof ArrayBuffer) {
            bodyArray = new Uint8Array(rawBody);
          } else if (ArrayBuffer.isView(rawBody)) {
            bodyArray = new Uint8Array(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
          }

          const result = await crossWorldMessenger.sendMessage(CrossWorldMessage.ProxyFetch, {
            url,
            bodyBase64: btoa(String.fromCharCode(...bodyArray))
          });
          if (!result?.bodyBase64) {
            throw new TypeError("Background fetch failed");
          }

          const responseBytes = Uint8Array.from(atob(result.bodyBase64), character => {
            return character.charCodeAt(0);
          });
          return new Response(responseBytes, {
            status: result.status,
            headers: { "content-type": "application/vnd.yt-ump" }
          });
        }
      }

      return new SabrStream({
        fetch: sabrFetchWithFallback,
        serverAbrStreamingUrl: sabrConfig.serverAbrStreamingUrl,
        videoPlaybackUstreamerConfig: sabrConfig.videoPlaybackUstreamerConfig,
        poToken: capturedPoToken || sabrCredentials.value?.poToken || undefined,
        clientInfo: {
          clientName: sabrConfig.clientName,
          clientVersion: sabrConfig.clientVersion
        },
        formats: sabrFormats,
        durationMs
      });
    }

    async function fetchViaSabrStream(
      sabrConfig: NonNullable<VideoData["sabrConfig"]>,
      videoFormat: AdaptiveFormatItem,
      audioFormat: AdaptiveFormatItem
    ) {
      const sabrStream = createSabrStream(sabrConfig);

      const { videoStream, audioStream } = await sabrStream.start({
        videoFormat: adaptiveFormatToSabrFormat(videoFormat),
        audioFormat: adaptiveFormatToSabrFormat(audioFormat)
      });

      const [videoData, audioData] = await Promise.all([
        collectReadableStream(videoStream),
        collectReadableStream(audioStream)
      ]);

      return {
        videoData,
        audioData
      };
    }

    async function fetchAudioViaSabrStream(
      sabrConfig: NonNullable<VideoData["sabrConfig"]>,
      audioFormat: AdaptiveFormatItem
    ) {
      const sabrStream = createSabrStream(sabrConfig);

      const targetFormat = adaptiveFormatToSabrFormat(audioFormat);
      const { audioStream } = await sabrStream.start({ audioFormat: targetFormat });
      return collectReadableStream(audioStream);
    }

    // Captured media data from SourceBuffer.appendBuffer
    const capturedMedia = new Map<string, {
      videoChunks: Uint8Array[];
      audioChunks: Uint8Array[];
      videoMimeType: string;
      audioMimeType: string;
      videoTotalBytes: number;
      audioTotalBytes: number;
    }>();
    let activeVideoId = "";

    // Track which SourceBuffers are video vs audio by their mime type
    const sourceBufferMimeTypes = new WeakMap<SourceBuffer, string>();

    const originalAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype.addSourceBuffer = function (mimeType) {
      const sourceBuffer = originalAddSourceBuffer.call(this, mimeType);
      if (mimeType.startsWith("video") || mimeType.startsWith("audio")) {
        sourceBufferMimeTypes.set(sourceBuffer, mimeType);
      }

      return sourceBuffer;
    };

    // Buffer data before activeVideoId is set (init segments arrive early)
    const pendingChunks: Array<{ mimeType: string;
      data: Uint8Array; }> = [];

    const originalAppendBuffer = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function (data) {
      const mimeType = sourceBufferMimeTypes.get(this);
      if (mimeType) {
        const chunk = data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        if (!activeVideoId || !capturedMedia.has(activeVideoId)) {
          pendingChunks.push({
            mimeType,
            data: chunk.slice()
          });
        } else {
          addChunkToCapture(capturedMedia.get(activeVideoId)!, mimeType, chunk);
        }
      }

      return originalAppendBuffer.call(this, data);
    };

    type MediaCapture = typeof capturedMedia extends Map<string, infer V> ? V : never;

    function addChunkToCapture(capture: MediaCapture, mimeType: string, chunk: Uint8Array) {
      if (mimeType.startsWith("video")) {
        capture.videoChunks.push(chunk.slice());
        capture.videoTotalBytes += chunk.byteLength;
        capture.videoMimeType = mimeType.split(";")[0];
      } else {
        capture.audioChunks.push(chunk.slice());
        capture.audioTotalBytes += chunk.byteLength;
        capture.audioMimeType = mimeType.split(";")[0];
      }
    }

    const videoDataCache = new Map<string, VideoData>();

    function readYtcfg() {
      const clientVersionRaw = ytcfg?.get("INNERTUBE_CLIENT_VERSION");
      const clientVersion = typeof clientVersionRaw === "string" ? clientVersionRaw : "";
      const clientNameRaw = ytcfg?.get("INNERTUBE_CONTEXT_CLIENT_NAME");
      const clientName = typeof clientNameRaw === "number" ? clientNameRaw : 1;
      return {
        clientVersion,
        clientName
      };
    }

    async function buildAndDispatchVideoData(playerResponse: PlayerResponse) {
      const { clientVersion, clientName } = readYtcfg();
      const videoData: VideoData = buildVideoData({ playerResponse, clientVersion, clientName });

      videoDataCache.set(videoData.videoId, videoData);
      videoDataStore.set(videoData.videoId, videoData);
      void crossWorldMessenger.sendMessage(CrossWorldMessage.VideoData, videoData);

      // Start capturing SourceBuffer data for this video
      activeVideoId = videoData.videoId;

      if (!capturedMedia.has(activeVideoId)) {
        capturedMedia.set(activeVideoId, {
          videoChunks: [],
          audioChunks: [],
          videoMimeType: "video/mp4",
          audioMimeType: "audio/mp4",
          videoTotalBytes: 0,
          audioTotalBytes: 0
        });
      }

      // Flush chunks that arrived before activeVideoId was set (init segments)
      if (pendingChunks.length > 0) {
        const capture = capturedMedia.get(activeVideoId)!;
        for (const pending of pendingChunks) {
          addChunkToCapture(capture, pending.mimeType, pending.data);
        }

        console.log(`[ytdl:capture] Flushed ${pendingChunks.length} pending chunks (init segments)`);
        pendingChunks.length = 0;
      }

      if (location.pathname === "/watch") {
        await injectSegmentedDownloadButton(videoData);

        // Generate PO token via BotGuard (independent of video playback)
        if (!capturedPoToken) {
          try {
            capturedPoToken = await generatePoToken(videoData.videoId);
            // Broadcast to isolated world via synced signal
            sabrCredentials.value = {
              url: videoData.sabrConfig?.serverAbrStreamingUrl ?? "",
              poToken: capturedPoToken
            };
          } catch (error) {
            console.warn("[ytdl] PO token generation failed:", error);
          }
        }
      }
    }

    async function extractAndDispatchVideoData() {
      const playerResponse = window.ytInitialPlayerResponse ?? null;
      if (!playerResponse || !location.pathname.startsWith("/watch")) {
        return;
      }

      await buildAndDispatchVideoData(playerResponse);
    }

    // - Download handler -
    // Fetches full video and audio streams directly from YouTube's CDN using
    // the pre-signed URLs in AdaptiveFormatItem, then posts to isolated world.

    async function fetchStreamFromUrl(
      url: string,
      onProgress: (receivedBytes: number, totalBytes: number) => void,
      fetchSignal?: AbortSignal
    ) {
      const response = await fetch(url, { signal: fetchSignal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} fetching stream`);
      }

      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (!response.body) {
        const buffer = await response.arrayBuffer();
        onProgress(buffer.byteLength, buffer.byteLength);
        return new Uint8Array(buffer);
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let receivedBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        chunks.push(value);
        receivedBytes += value.byteLength;
        onProgress(receivedBytes, contentLength);
      }

      const result = new Uint8Array(receivedBytes);
      let writeOffset = 0;

      for (const chunk of chunks) {
        result.set(chunk, writeOffset);
        writeOffset += chunk.byteLength;
      }

      return result;
    }

    async function resolveFormatUrl(format: AdaptiveFormatItem | null) {
      if (!format) {
        return null;
      }

      if (format.url) {
        return format.url;
      }

      if (format.signatureCipher) {
        return decryptSignatureCipher(format.signatureCipher);
      }

      return null;
    }

    function getExtraAudioFormats(
      audioFormats: AdaptiveFormatItem[],
      selectedTrackId: string | undefined
    ) {
      if (!selectedTrackId) {
        return [];
      }

      // audioFormats is sorted by bitrate desc, so first per unique audioTrack.id = best quality.
      const seenTrackIds = new Set([selectedTrackId]);
      return audioFormats.filter(format => {
        const trackId = format.audioTrack?.id;
        if (!trackId || seenTrackIds.has(trackId)) {
          return false;
        }

        seenTrackIds.add(trackId);
        return true;
      });
    }

    interface StreamDataEvent {
      type: DownloadType;
      videoId: string;
      filenameOutput: string;
      videoData: Uint8Array | null;
      audioData: Uint8Array | null;
      videoMimeType: string;
      audioMimeType: string;
      audioLabel: string;
      additionalAudioData: Array<{ data: Uint8Array | null;
        mimeType: string;
        label: string; }>;
    }

    function buildVideoMetadata(videoId: string) {
      const cached = videoDataCache.get(videoId);
      if (!cached) {
        return undefined;
      }

      const { playerResponse } = cached;
      const thumbnails = playerResponse.videoDetails?.thumbnail?.thumbnails ?? [];
      // Pick the largest thumbnail for cover art
      const thumbnailUrl = thumbnails.length > 0
        ? thumbnails[thumbnails.length - 1].url
        : undefined;

      return {
        title: cached.title,
        artist: playerResponse.videoDetails?.author ?? "",
        date: playerResponse.microformat?.playerMicroformatRenderer.publishDate,
        thumbnailUrl,
        isMusic: cached.isMusic
      };
    }

    function dispatchStreamData({
      type, videoId, filenameOutput,
      videoData, audioData, videoMimeType, audioMimeType,
      audioLabel, additionalAudioData
    }: StreamDataEvent) {
      postMessage({
        namespace: SYNC_NAMESPACE,
        key: SyncKey.StreamData,
        value: {
          downloadType: type,
          videoId,
          filenameOutput,
          videoData,
          audioData,
          videoMimeType,
          audioMimeType,
          audioLabel,
          additionalAudioData,
          metadata: buildVideoMetadata(videoId)
        }
      }, location.origin);
    }

    function dispatchStreamError(videoId: string, error: string) {
      void crossWorldMessenger.sendMessage(CrossWorldMessage.StreamError, {
        videoId,
        error
      });
    }

    const activeDownloads = new Map<string, AbortController>();

    function cancelActiveDownload(videoId: string) {
      const controller = activeDownloads.get(videoId);
      if (controller) {
        controller.abort();
        activeDownloads.delete(videoId);
      }
    }

    addEventListener("message", e => {
      if (e.data?.namespace !== SYNC_NAMESPACE || e.data.key !== SyncKey.CancelDownload) {
        return;
      }

      for (const id of e.data.value?.videoIds ?? []) {
        cancelActiveDownload(id);
      }
    });

    async function performDownload({
      type,
      videoId,
      videoItag,
      audioItag,
      filenameOutput
    }: Pick<DownloadRequest, "type" | "videoId" | "videoItag" | "audioItag" | "filenameOutput">) {
      cancelActiveDownload(videoId);
      const abortController = new AbortController();
      activeDownloads.set(videoId, abortController);
      const { signal } = abortController;

      try {
        const cachedVideoData = videoDataCache.get(videoId);
        if (!cachedVideoData) {
          console.error("[ytdl] No video data cached for", videoId);
          return;
        }

        const videoFormat = type !== "audio"
          ? (cachedVideoData.videoFormats.find(format => {
            return format.itag === videoItag;
          }) ?? cachedVideoData.videoFormats[0])
          : null;
        const audioFormat = type !== "video"
          ? (cachedVideoData.audioFormats.find(format => {
            return format.itag === audioItag;
          }) ?? cachedVideoData.audioFormats[0])
          : null;

        const videoMimeType = videoFormat?.mimeType.split(";")[0] ?? "video/mp4";
        const audioMimeType = audioFormat?.mimeType.split(";")[0] ?? "audio/mp4";
        const audioLabel = audioFormat?.audioTrack?.displayName ?? "";
        const extraAudioFormats = getExtraAudioFormats(
          cachedVideoData.audioFormats, audioFormat?.audioTrack?.id
        );
        // Strategy 1: SabrStream - independently fetch the full video without
        // relying on playback state. Works even if the video is paused.
        // Read SABR credentials from synced signal or DOM fallback.
        // The postMessage from the isolated world may arrive before the
        // MAIN world's listener is ready, so also check the DOM element
        // that sabr-credentials.ts writes as a persistent fallback.
        const creds = sabrCredentials.value;
        if (creds?.url) {
          capturedSabrUrl = creds.url;
        }

        if (creds?.poToken) {
          capturedPoToken = creds.poToken;
        }

        if (!capturedPoToken || !capturedSabrUrl) {
          const elCredentials = document.getElementById("ytdl-sabr-credentials");
          if (elCredentials?.dataset.url) {
            capturedSabrUrl = elCredentials.dataset.url;
          }

          if (elCredentials?.dataset.poToken) {
            capturedPoToken = elCredentials.dataset.poToken;
          }
        }

        if (cachedVideoData.sabrConfig && videoFormat && audioFormat) {
          try {
            console.log("[ytdl] Fetching via SabrStream (independent of playback)");

            const primaryResult = await fetchViaSabrStream(
              cachedVideoData.sabrConfig, videoFormat, audioFormat
            );
            console.log(`[ytdl] SabrStream done: video=${primaryResult.videoData.byteLength} audio=${primaryResult.audioData.byteLength}`);

            // Fetch additional audio tracks in parallel
            const additionalAudioData = await Promise.all(
              extraAudioFormats.map(async format => {
                try {
                  const audioData = await fetchAudioViaSabrStream(
                    cachedVideoData.sabrConfig!, format
                  );

                  return {
                    data: audioData,
                    mimeType: format.mimeType.split(";")[0] ?? "audio/mp4",
                    label: format.audioTrack?.displayName ?? ""
                  };
                } catch (trackError) {
                  console.warn("[ytdl] Extra audio track failed:", format.audioTrack?.displayName, trackError);
                  return null;
                }
              })
            );

            dispatchStreamData({
              type,
              videoId,
              filenameOutput,
              videoData: type !== "audio" ? primaryResult.videoData : null,
              audioData: type !== "video" ? primaryResult.audioData : null,
              videoMimeType,
              audioMimeType,
              audioLabel,
              additionalAudioData: additionalAudioData
                .filter((track): track is NonNullable<typeof track> => {
                  return track !== null;
                })
            });

            capturedMedia.delete(videoId);
            document.dispatchEvent(new CustomEvent("ytdl:clear-interrupted", { detail: { videoId } }));
            return;
          } catch (sabrError) {
            console.warn("[ytdl] SabrStream failed, trying fallback:", sabrError);
            document.dispatchEvent(new CustomEvent("ytdl:persist-interrupted", {
              detail: {
                videoId,
                type,
                filenameOutput,
                videoItag,
                audioItag,
                timestamp: Date.now()
              }
            }));
          }
        }

        // Strategy 2: CDN fetch with signature decryption.
        // Formats either have a direct `url` or an encrypted `signatureCipher`.
        // Decrypt signatureCipher using the transformation sequence from player.js.
        const hasDownloadableFormats = videoFormat?.url || videoFormat?.signatureCipher
        || audioFormat?.url || audioFormat?.signatureCipher;        if (hasDownloadableFormats) {
          try {
            const [resolvedVideoUrl, resolvedAudioUrl, ...resolvedExtraUrls] = await Promise.all([
              type !== "audio" ? resolveFormatUrl(videoFormat) : Promise.resolve(null),
              type !== "video" ? resolveFormatUrl(audioFormat) : Promise.resolve(null),
              ...extraAudioFormats.map(format => {
                return resolveFormatUrl(format);
              })
            ]);            if (!resolvedVideoUrl && !resolvedAudioUrl) {
              console.warn("[ytdl] Could not resolve any format URLs");
            } else {
              let totalExpectedBytes = 0;
              let totalReceivedBytes = 0;

              function reportDownloadProgress(receivedBytes: number, totalBytes: number) {
                totalExpectedBytes = Math.max(totalExpectedBytes, totalBytes);
                totalReceivedBytes = receivedBytes;

                if (totalExpectedBytes > 0) {
                  postMessage({
                    namespace: SYNC_NAMESPACE,
                    key: SyncKey.DownloadProgress,
                    value: {
                      mapKey: videoId,
                      mapValue: {
                        isDownloading: true,
                        isDone: false,
                        isQueued: false,
                        progress: Math.min(totalReceivedBytes / totalExpectedBytes, 1),
                        progressType: ProgressType.Video
                      }
                    }
                  }, location.origin);
                }
              }

              const [videoBytes, audioBytes, ...extraAudioBytes] = await Promise.all([
                resolvedVideoUrl
                  ? fetchStreamFromUrl(resolvedVideoUrl, reportDownloadProgress, signal)
                  : Promise.resolve(null),
                resolvedAudioUrl
                  ? fetchStreamFromUrl(resolvedAudioUrl, reportDownloadProgress, signal)
                  : Promise.resolve(null),
                ...resolvedExtraUrls.map(url => {
                  return url
                    ? fetchStreamFromUrl(url, reportDownloadProgress, signal)
                    : Promise.resolve(null);
                }
                )
              ]);

              const additionalAudioData = extraAudioFormats.map((format, iTrack) => {
                return {
                  data: extraAudioBytes[iTrack] ?? null,
                  mimeType: format.mimeType.split(";")[0] ?? "audio/mp4",
                  label: format.audioTrack?.displayName ?? `Track ${iTrack + 2}`
                };
              });

              dispatchStreamData({
                type,
                videoId,
                filenameOutput,
                videoData: videoBytes,
                audioData: audioBytes,
                videoMimeType,
                audioMimeType,
                audioLabel,
                additionalAudioData
              });
              return;
            }
          } catch (cdnError) {
            console.warn("[ytdl] CDN fetch failed, trying SourceBuffer fallback:", cdnError);
          }
        }

        // Strategy 3: SourceBuffer capture - use whatever the player has buffered.
        // This is a last resort: it only has what the player loaded so far.
        const capture = capturedMedia.get(videoId);
        if (capture && (capture.videoTotalBytes > 0 || capture.audioTotalBytes > 0)) {
          const videoBytes = assembleChunks(capture.videoChunks, capture.videoTotalBytes);
          const audioBytes = assembleChunks(capture.audioChunks, capture.audioTotalBytes);
          console.log(`[ytdl] SourceBuffer fallback: video=${videoBytes.byteLength} audio=${audioBytes.byteLength}`);

          dispatchStreamData({
            type,
            videoId,
            filenameOutput,
            videoData: videoBytes,
            audioData: audioBytes,
            videoMimeType: capture.videoMimeType,
            audioMimeType: capture.audioMimeType,
            audioLabel,
            additionalAudioData: []
          });

          capturedMedia.delete(videoId);
          return;
        }

        // All strategies failed - persist as interrupted so user can resume later
        document.dispatchEvent(new CustomEvent("ytdl:persist-interrupted", {
          detail: {
            videoId,
            type,
            filenameOutput,
            videoItag,
            audioItag,
            timestamp: Date.now()
          }
        }));

        dispatchStreamError(videoId, "No download method available - try reloading the page");
      } catch (error) {
        if (signal.aborted) {
          return;
        }

        throw error;
      } finally {
        activeDownloads.delete(videoId);
      }
    }

    function assembleChunks(chunks: Uint8Array[], totalBytes: number) {
      const result = new Uint8Array(totalBytes);
      let writeOffset = 0;
      for (const chunk of chunks) {
        result.set(chunk, writeOffset);
        writeOffset += chunk.byteLength;
      }
      return result;
    }

    // - Segmented download button injection -
    // Two adjacent yt-button-view-model elements (download + chevron) wrapped in
    // an inline-flex group.  After Polymer renders the inner <button> elements in
    // light DOM we add --segmented-start / --segmented-end so they visually join
    // into a single pill, identical to YouTube's own like/dislike button.

    const VIDEO_ACTION_BUTTON_SELECTORS = [
      "#above-the-fold #top-level-buttons-computed",
      "ytd-watch-metadata #top-level-buttons-computed",
      "#top-level-buttons-computed"
    ];

    let cleanupCurrentButton: (() => void) | null = null;
    let injectionGeneration = 0;

    function findVideoActionsContainer() {
      function findFirstVisible() {
        for (const selector of VIDEO_ACTION_BUTTON_SELECTORS) {
          for (const element of document.querySelectorAll<HTMLElement>(selector)) {
            if (element.offsetWidth > 0 && element.offsetHeight > 0) {
              return element;
            }
          }
        }

        return null;
      }

      const existing = findFirstVisible();
      if (existing) {
        return Promise.resolve(existing);
      }

      return new Promise<HTMLElement | null>(resolve => {
        const timeout = setTimeout(() => {
          observer.disconnect();
          resolve(null);
        }, 10_000);

        const observer = new MutationObserver(() => {
          const element = findFirstVisible();
          if (!element) {
            return;
          }

          observer.disconnect();
          clearTimeout(timeout);
          resolve(element);
        });

        observer.observe(document.documentElement, {
          childList: true,
          subtree: true
        });
      });
    }

    function cleanupSegmentedButton() {
      cleanupCurrentButton?.();
      cleanupCurrentButton = null;
    }

    async function injectSegmentedDownloadButton(videoData: VideoData) {
      cleanupSegmentedButton();

      if (!videoData.isDownloadable) {
        return;
      }

      const generation = ++injectionGeneration;

      const elActionsContainer = await findVideoActionsContainer();
      if (!elActionsContainer || generation !== injectionGeneration) {
        return;
      }

      const { videoId } = videoData;
      let defaultVideoItag = videoData.videoFormats[0]?.itag ?? 0;
      let defaultAudioItag = videoData.audioFormats[0]?.itag ?? 0;
      const defaultVideoMime = videoData.videoFormats[0]?.mimeType ?? "video/mp4";
      const defaultAudioMime = videoData.audioFormats[0]?.mimeType ?? "audio/mp4";
      let defaultExtension: string;
      if (videoData.isMusic) {
        defaultExtension = defaultAudioMime.includes("webm") ? "webm" : "m4a";
      } else {
        defaultExtension = getOutputExtension(defaultVideoMime, defaultAudioMime, "mp4");
      }

      let defaultFilename = getCompatibleFilename(
        `${videoData.title}.${defaultExtension}`
      );
      let defaultQuality = "";
      const defaultDownloadType: DownloadType = videoData.isMusic ? "audio" : "video+audio";

      let isDownloading = false;
      let isDone = false;
      let isInterrupted = false;
      let isPanelOpen = false;
      let downloadProgress = 0;

      // Check for interrupted download from a previous session
      const interrupted = interruptedDownloadStore.get(videoId);
      if (interrupted) {
        isInterrupted = true;
        defaultVideoItag = interrupted.videoItag || defaultVideoItag;
        defaultAudioItag = interrupted.audioItag || defaultAudioItag;
      }

      // Grab Polymer CSS scoping class from last native yt-button-view-model
      const nativeButtons = elActionsContainer.querySelectorAll("yt-button-view-model");
      const scopingClass =
        nativeButtons[nativeButtons.length - 1]?.getAttribute("class") ?? "";

      // Hide YouTube's native Download button.
      // We use setAttribute("style",...) rather than .style property because Polymer
      // overrides the .style getter on yt-button-view-model with a Symbol.
      // We identify it by .data.iconName (set by Polymer) or the inner button's
      // aria-label, rather than assuming position - the Share button sits between
      // like/dislike and Download in the action bar and would otherwise be hidden.
      function findNativeDownloadButton() {
        const buttons = elActionsContainer!.querySelectorAll<YtButtonViewModelElement>(
          "yt-button-view-model"
        );
        for (const button of buttons) {
          if (button.data?.iconName?.includes(IconName.Download)) {
            return button;
          }

          const elInnerButton = button.querySelector("button");
          if (elInnerButton?.getAttribute("aria-label")?.toLowerCase().includes("download")) {
            return button;
          }
        }

        return null;
      }

      const elNativeDownload = findNativeDownloadButton();
      if (elNativeDownload) {
        elNativeDownload.classList.add("ytdl-native-hidden");
      }

      // - Button data builders -

      function buildDownloadData() {
        let iconName = IconName.Download;
        if (isDone) {
          iconName = IconName.Downloaded;
        } else if (isDownloading) {
          iconName = IconName.Close;
        }

        let title = "Download";
        let accessibilityText = "Download";
        if (!videoData.isDownloadable) {
          title = "Not downloadable";
          accessibilityText = "Not downloadable";
        } else if (isDone) {
          title = "Download";
          accessibilityText = "Download again";
        } else if (isDownloading) {
          title = "Cancel";
          accessibilityText = "Cancel download";
        } else if (isInterrupted) {
          title = "Resume";
          accessibilityText = "Resume download";
        }

        const isDisabled = !videoData.isDownloadable;

        let tooltip = "";
        if (videoData.isDownloadable) {
          if (isDownloading && downloadProgress > 0) {
            tooltip = `${Math.round(downloadProgress * 100)}%`;
          } else {
            tooltip = defaultQuality ? `${defaultFilename} - ${defaultQuality}` : defaultFilename;
          }
        }

        return {
          iconName,
          title,
          accessibilityText,
          style: ButtonStyle.Mono,
          type: ButtonType.Tonal,
          buttonSize: ButtonSize.Default,
          state: isDisabled ? ButtonState.Disabled : ButtonState.Active,
          isFullWidth: false,
          isDisabled,
          tooltip
        } satisfies ButtonViewModelData;
      }

      function buildChevronData() {
        const isDisabled = (isDownloading && !isDone) || !videoData.isDownloadable;

        return {
          iconName: isPanelOpen ? IconName.ExpandLess : IconName.ExpandMore,
          title: "",
          accessibilityText: isPanelOpen ? "Close download options" : "Open download options",
          style: ButtonStyle.Mono,
          type: ButtonType.Tonal,
          buttonSize: ButtonSize.Default,
          state: isDisabled ? ButtonState.Disabled : ButtonState.Active,
          isFullWidth: false,
          isDisabled,
          tooltip: isPanelOpen ? "Close download options" : "Download options"
        } satisfies ButtonViewModelData;
      }

      // - Create elements -
      // Wrapper: flex so the two buttons sit in a single layout box.
      // A real layout box is required for dropdown.positionTarget to resolve to
      // correct coordinates (display:contents has no geometry - top-left corner).
      // margin-left matches the gap YouTube gives every other action-bar item via
      // its [button-renderer] + yt-button-view-model adjacent-sibling rule; our div
      // is not a yt-button-view-model so it doesn't receive that rule automatically.
      // Inject styles once for the download button group
      if (!document.getElementById("ytdl-watch-styles")) {
        const elStyle = document.createElement("style");
        elStyle.id = "ytdl-watch-styles";
        elStyle.textContent = watchButtonStyles;
        document.head.append(elStyle);
      }

      const elGroup = document.createElement("div");
      elGroup.dataset.ytdlDownloadGroup = "true";

      const elDownloadButton = document.createElement("yt-button-view-model");
      const elChevronButton = document.createElement("yt-button-view-model");

      const elProgressBar = document.createElement("tp-yt-paper-progress");
      elProgressBar.classList.add("ytdl-watch-progress");

      elGroup.append(elDownloadButton, elChevronButton, elProgressBar);

      // Polymer's Shady DOM requires updateStyles for CSS custom properties
      elProgressBar.updateStyles({
        "--paper-progress-active-color": "var(--yt-spec-call-to-action, rgb(62 166 255))",
        "--paper-progress-container-color": "transparent"
      });

      // Insert group in the slot the native download button occupied.
      if (elNativeDownload) {
        elNativeDownload.insertAdjacentElement("beforebegin", elGroup);
      } else {
        elActionsContainer.append(elGroup);
      }

      // - Options panel (tp-yt-iron-dropdown) -
      // Use YouTube's own dropdown element for correct viewport-aware positioning
      // and native click-outside / Escape-key dismissal.

      const panelContentId = `ytdl-panel-content-${videoId}`;
      const elDropdown = document.createElement("tp-yt-iron-dropdown");

      // ytd-menu-popup-renderer is YouTube's native popup shell: it provides
      // theme-aware background, border-radius, and box-shadow automatically.
      // Its shadow DOM exposes a default <slot>, so our Svelte content mounts
      // as light DOM children and is projected through that slot.
      const elDropdownContentSlot = document.createElement("ytd-menu-popup-renderer");
      elDropdownContentSlot.slot = "dropdown-content";
      elDropdownContentSlot.id = panelContentId;
      elDropdown.append(elDropdownContentSlot);

      const elPopupContainer = document.querySelector("ytd-popup-container") ?? document.body;
      elPopupContainer.append(elDropdown);

      // Set Polymer properties after the element is connected to the DOM
      elDropdown.positionTarget = elGroup;
      elDropdown.horizontalAlign = "left";
      elDropdown.verticalAlign = "top";
      elDropdown.noOverlap = true;
      elDropdown.dynamicAlign = true;
      elDropdown.allowOutsideScroll = false;
      elDropdown.restoreFocusOnClose = false;

      // Notify the isolated world where to mount the Svelte panel.
      // Fire-and-forget: must not await, or the button setup below never runs
      // (sendMessage waits for a response that never comes for void handlers).
      void crossWorldMessenger.sendMessage(CrossWorldMessage.PanelContentReady, {
        contentId: panelContentId,
        videoData
      });

      // Set Polymer scoping class and data AFTER insertion so connectedCallback
      // does not wipe the class attribute
      elDownloadButton.classList.add(...scopingClass.split(" ").filter(Boolean));
      elDownloadButton.data = buildDownloadData();
      elDownloadButton.dataset.ytdlDownload = "true";

      elChevronButton.classList.add(...scopingClass.split(" ").filter(Boolean));
      elChevronButton.data = buildChevronData();
      // [data-ytdl-chevron] suppresses the automatic margin-left between
      // adjacent yt-button-view-model siblings so the buttons sit flush.
      elChevronButton.dataset.ytdlChevron = "true";

      // - Segmented classes -
      // Polymer renders <button> into light DOM asynchronously.
      // We use a MutationObserver + requestAnimationFrame to apply the classes
      // as soon as the element is available (and after any re-render).

      function applySegmentedClasses() {
        const elDownloadInnerButton = elDownloadButton.querySelector<HTMLButtonElement>("button");
        const elChevronInnerButton = elChevronButton.querySelector<HTMLButtonElement>("button");
        if (elDownloadInnerButton) {
          elDownloadInnerButton.classList.add("yt-spec-button-shape-next--segmented-start");
        }

        if (elChevronInnerButton) {
          elChevronInnerButton.classList.add("yt-spec-button-shape-next--segmented-end");
        }
      }

      const segmentedObserver = new MutationObserver(applySegmentedClasses);
      segmentedObserver.observe(elDownloadButton, {
        childList: true,
        subtree: true
      });
      segmentedObserver.observe(elChevronButton, {
        childList: true,
        subtree: true
      });
      requestAnimationFrame(applySegmentedClasses);

      function refreshButtons() {
        elDownloadButton.data = buildDownloadData();
        elChevronButton.data = buildChevronData();
        requestAnimationFrame(applySegmentedClasses);

        elProgressBar.indeterminate = isDownloading && downloadProgress === 0;
        elProgressBar.value = Math.round(downloadProgress * 100);
        elProgressBar.style.opacity = isDownloading ? "1" : "0";
      }

      // - Click handler -

      function handleClick(e: Event) {
        const { target } = e;
        if (!(target instanceof Node)) {
          return;
        }

        if (elDownloadButton.contains(target)) {
          if (!videoData.isDownloadable) {
            return;
          }

          if (isDownloading) {
            isDownloading = false;
            refreshButtons();
            cancelActiveDownload(videoId);
            postMessage({
              namespace: SYNC_NAMESPACE,
              key: SyncKey.CancelRequest,
              value: { videoIds: [videoId] }
            }, location.origin);
            return;
          }

          isDone = false;
          isInterrupted = false;
          isDownloading = true;
          downloadProgress = 0;
          refreshButtons();
          postMessage({
            namespace: SYNC_NAMESPACE,
            key: SyncKey.DownloadRequest,
            value: JSON.parse(JSON.stringify({
              type: defaultDownloadType,
              videoId,
              videoItag: defaultVideoItag,
              audioItag: defaultAudioItag,
              filenameOutput: defaultFilename
            }))
          }, location.origin);
          return;
        }

        if (elChevronButton.contains(target)) {
          if (!videoData.isDownloadable) {
            return;
          }

          isPanelOpen = !isPanelOpen;
          refreshButtons();

          if (isPanelOpen) {
            // Stop propagation so Polymer's click-outside handler
            // doesn't immediately close the dropdown we just opened
            e.stopPropagation();
            elDropdown.open();
            elChevronButton.querySelector<HTMLButtonElement>("button")?.blur();
          } else {
            elDropdown.close();
          }
        }
      }

      // - Progress handler -

      function handleProgress({ data }: { data: ProgressUpdate }) {
        if (data.videoId !== videoId) {
          return;
        }

        if (data.isRemoved) {
          isDownloading = false;
          downloadProgress = 0;
          refreshButtons();
          return;
        }

        downloadProgress = data.progress;

        if (data.progress >= 1) {
          isDone = true;
          isDownloading = false;
          downloadProgress = 0;
        }

        refreshButtons();
      }

      // - Panel close notifications -
      // From Svelte (X button, Escape key): close the Polymer dropdown
      function handlePanelClosed() {
        if (!isPanelOpen) {
          return;
        }

        isPanelOpen = false;
        refreshButtons();
        elDropdown.close();
      }

      // From Polymer (click-outside, Escape key): sync MAIN world state
      function handleDropdownClosed() {
        if (!isPanelOpen) {
          return;
        }

        isPanelOpen = false;
        refreshButtons();
        // Restore focus to the chevron button
        elChevronButton.querySelector<HTMLButtonElement>("button")?.focus();
      }

      // Refit the dropdown whenever the panel content resizes (e.g. switching tabs)
      // so the dropdown stays anchored to the button group rather than floating away.
      const resizeObserver = new ResizeObserver(() => {
        if (elDropdown.opened) {
          elDropdown.refit();
        }
      });
      resizeObserver.observe(elDropdownContentSlot);

      const unsubscribeProgress = crossWorldMessenger.onMessage(
        CrossWorldMessage.Progress, handleProgress
      );

      // Also listen for direct download progress via synced signal (postMessage)
      function handleSyncedProgress(e: MessageEvent) {
        if (e.data?.namespace !== SYNC_NAMESPACE || e.data.key !== SyncKey.DownloadProgress) {
          return;
        }

        const { mapKey, mapValue } = e.data.value ?? {};
        if (mapKey !== videoId || !mapValue) {
          return;
        }

        downloadProgress = mapValue.progress;
        refreshButtons();
      }

      addEventListener("message", handleSyncedProgress);
      const unsubscribePanelClosed = crossWorldMessenger.onMessage(
        CrossWorldMessage.PanelClosed, () => {
          return handlePanelClosed();
        }
      );
      const unsubscribeFilenameChanged = crossWorldMessenger.onMessage(
        CrossWorldMessage.FilenameChanged, ({ data }) => {
          defaultFilename = data.filename;
          defaultQuality = data.quality ?? "";

          if (data.videoItag !== undefined) {
            defaultVideoItag = data.videoItag;
          }

          if (data.audioItag !== undefined) {
            defaultAudioItag = data.audioItag;
          }

          refreshButtons();
        });

      elActionsContainer.addEventListener("click", handleClick);
      elDropdown.addEventListener("iron-overlay-closed", handleDropdownClosed);

      cleanupCurrentButton = () => {
        segmentedObserver.disconnect();
        resizeObserver.disconnect();
        elActionsContainer.removeEventListener("click", handleClick);
        unsubscribeProgress();
        removeEventListener("message", handleSyncedProgress);
        unsubscribePanelClosed();
        unsubscribeFilenameChanged();
        elDropdown.removeEventListener("iron-overlay-closed", handleDropdownClosed);
        elGroup.remove();
        elDropdown.remove();
        elNativeDownload?.classList.remove("ytdl-native-hidden");
      };
    }

    // - Navigation handling -
    // yt-navigate-finish fires first but ytInitialPlayerResponse is still stale.
    // yt-page-data-updated fires after and ytd-watch-flexy.playerData has the fresh response.

    function handleNavigation() {
      cleanupSegmentedButton();
      void crossWorldMessenger.sendMessage(CrossWorldMessage.Navigation, { url: location.href });
      extractPlaylistMetadata();
    }

    function extractPlaylistMetadata() {
      const initialData = window.ytInitialData;
      if (!initialData) {
        playlistMetadataSignal.value = null;
        return;
      }

      const headerRenderer = initialData.header?.playlistHeaderRenderer;
      const metadataRenderer = initialData.metadata?.playlistMetadataRenderer;

      const playlistTitle = headerRenderer?.title?.simpleText
        ?? metadataRenderer?.title
        ?? "";
      const playlistId = headerRenderer?.playlistId ?? "";
      if (!playlistTitle && !playlistId) {
        playlistMetadataSignal.value = null;
        return;
      }

      playlistMetadataSignal.value = {
        playlistId,
        playlistTitle
      };
    }

    // - Panel button initialisation bridge -
    // yt-button-view-model's `.data` setter is defined by Polymer in the MAIN
    // world. The isolated-world Svelte component cannot invoke it directly.
    // It dispatches a bubbling "ytdl:set-yt-button-data" event so this handler
    // (running in the MAIN world) can set the property on its behalf.
    function handleSetButtonData(e: Event) {
      if (!(e instanceof CustomEvent)) {
        return;
      }

      if (!(e.target instanceof HTMLElement)) {
        return;
      }

      Object.assign(e.target, { data: e.detail });
    }

    document.addEventListener("ytdl:set-yt-button-data", handleSetButtonData);

    // Create/close Polymer dropdown for grid/playlist item panels.
    // The isolated world can't use Polymer elements (open/close, positioning)
    // so it delegates creation to the MAIN world.
    const gridDropdowns = new Map<string, TpYtIronDropdownElement>();

    addEventListener("message", e => {
      if (e.data?.namespace !== SYNC_NAMESPACE || e.data.key !== SyncKey.CreateDropdown) {
        return;
      }

      const { contentId, positionTargetSelector } = e.data.value;
      const elPositionTarget = document.querySelector(positionTargetSelector);
      if (!elPositionTarget) {
        return;
      }

      // Clean up any existing dropdown for this content ID (from a previous open)
      const existingDropdown = gridDropdowns.get(contentId);
      if (existingDropdown) {
        existingDropdown.close();
        existingDropdown.remove();
        gridDropdowns.delete(contentId);
      }

      const elDropdownContentSlot = document.createElement("ytd-menu-popup-renderer");
      elDropdownContentSlot.slot = "dropdown-content";
      elDropdownContentSlot.id = contentId;

      const elDropdown = document.createElement("tp-yt-iron-dropdown");
      elDropdown.append(elDropdownContentSlot);

      const elPopupContainer = document.querySelector("ytd-popup-container") ?? document.body;
      elPopupContainer.append(elDropdown);

      elDropdown.positionTarget = elPositionTarget;
      elDropdown.horizontalAlign = "left";
      elDropdown.verticalAlign = "top";
      elDropdown.noOverlap = true;
      elDropdown.dynamicAlign = true;
      elDropdown.allowOutsideScroll = false;
      elDropdown.restoreFocusOnClose = false;

      // Refit the dropdown when panel content changes size (e.g. progress bar appears)
      const resizeObserver = new ResizeObserver(() => {
        if (elDropdown.opened) {
          elDropdown.refit();
        }
      });

      resizeObserver.observe(elDropdownContentSlot);
      gridDropdowns.set(contentId, elDropdown);

      // Notify the isolated world that the dropdown is ready, then open it.
      // Opening after a frame lets Polymer finish initialization.
      postMessage({
        namespace: SYNC_NAMESPACE,
        key: SyncKey.DropdownReady,
        value: { contentId }
      }, location.origin);
      requestAnimationFrame(() => {
        return elDropdown.open();
      });
    });

    addEventListener("message", e => {
      if (e.data?.namespace !== SYNC_NAMESPACE || e.data.key !== SyncKey.CloseDropdown) {
        return;
      }

      const { videoId: dropdownVideoId } = e.data.value;
      const contentId = `ytdl-grid-panel-${dropdownVideoId}`;
      const elDropdown = gridDropdowns.get(contentId);
      if (elDropdown) {
        elDropdown.close();
        elDropdown.remove();
        gridDropdowns.delete(contentId);
      }
    });

    // Polymer's IronFocusedBehavior tracks keyboard vs pointer focus via
    // receivedFocusFromKeyboard, but it doesn't reflect to an attribute.
    // Bridge it to a [keyboard-focused] attribute so CSS in the isolated world
    // can show a focus ring only for keyboard users (WCAG 2.4.7).
    function handleDropdownFocusIn(e: FocusEvent) {
      if (!(e.target instanceof Element)) {
        return;
      }

      const elDropdown = e.target.closest("tp-yt-paper-dropdown-menu");
      if (!elDropdown) {
        return;
      }

      if (elDropdown.receivedFocusFromKeyboard) {
        elDropdown.setAttribute("keyboard-focused", "");
      }
    }

    function handleDropdownFocusOut(e: FocusEvent) {
      if (!(e.target instanceof Element)) {
        return;
      }

      const elDropdown = e.target.closest("tp-yt-paper-dropdown-menu");
      if (!elDropdown) {
        return;
      }

      requestAnimationFrame(() => {
        if (!elDropdown.contains(document.activeElement)) {
          elDropdown.removeAttribute("keyboard-focused");
        }
      });
    }

    document.addEventListener("focusin", handleDropdownFocusIn);
    document.addEventListener("focusout", handleDropdownFocusOut);

    async function handleNavigateSuccess() {
      await handleNavigation();

      if (location.pathname !== "/watch") {
        return;
      }

      // YouTube updates ytd-watch-flexy.playerData asynchronously after
      // navigation. Poll briefly until it matches the current video ID.
      const expectedVideoId = new URLSearchParams(location.search).get("v");
      for (let iAttempt = 0; iAttempt < 20; iAttempt++) {
        const playerResponse = document.querySelector("ytd-watch-flexy")?.playerData ?? null;
        if (playerResponse?.videoDetails?.videoId === expectedVideoId) {
          await buildAndDispatchVideoData(playerResponse);
          return;
        }

        await new Promise(resolve => {
          return setTimeout(resolve, 250);
        });
      }
    }

    navigation.addEventListener("navigatesuccess", handleNavigateSuccess);

    // Handle download requests from Svelte panel components (via isolated world)
    crossWorldMessenger.onMessage(CrossWorldMessage.DownloadRequest, async ({ data }) => {
      await performDownload(data);
    });

    // Refresh PO token on demand (background requests this when SPS escalates)
    crossWorldMessenger.onMessage(CrossWorldMessage.RefreshPoToken, async ({ data }) => {
      try {
        const token = await generatePoToken(data.videoId);
        capturedPoToken = token;
        return token;
      } catch {
        return null;
      }
    });

    // Handle video data requests from grid/playlist items.
    // Uses YouTube's /player API directly instead of fetching full watch pages,
    // which is faster and avoids rate-limiting from HTML page requests.

    const MAX_CONCURRENT_FETCHES = 3;
    const videoDataPending = new Set<string>();
    let activeVideoDataFetches = 0;

    async function fetchVideoDataViaApi(videoId: string) {
      // The /player API returns UNPLAYABLE on non-watch pages, so fetch
      // the watch page HTML and extract ytInitialPlayerResponse instead.
      const isWatchPage = location.pathname === "/watch";
      if (isWatchPage) {
        const { clientVersion, clientName } = readYtcfg();
        const visitorData = ytcfg?.get("VISITOR_DATA") ?? "";
        const signatureTimestamp = ytcfg?.get("STS");

        const playerData = await (await globalThis.fetch(
          "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
          {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Visitor-Id": String(visitorData)
            },
            body: JSON.stringify({
              videoId,
              context: {
                client: {
                  clientName: clientName === 1 ? "WEB" : String(clientName),
                  clientVersion: String(clientVersion)
                }
              },
              playbackContext: { contentPlaybackContext: { signatureTimestamp } },
              contentCheckOk: true,
              racyCheckOk: true
            })
          }
        )).json();
        if (playerData?.videoDetails?.videoId) {
          await buildAndDispatchVideoData(playerData);
          return;
        }
      }

      // Fallback: fetch watch page HTML and extract player response
      const html = await (await globalThis.fetch(
        `https://www.youtube.com/watch?v=${videoId}`,
        { credentials: "include" }
      )).text();

      const playerResponse = extractPlayerResponseFromHtml(html);
      if (playerResponse?.videoDetails?.videoId) {
        await buildAndDispatchVideoData(playerResponse);
      }
    }

    async function processNextVideoData() {
      if (activeVideoDataFetches >= MAX_CONCURRENT_FETCHES || videoDataPending.size === 0) {
        return;
      }

      const { value: videoId } = videoDataPending.values().next();
      if (!videoId) {
        return;
      }

      videoDataPending.delete(videoId);
      activeVideoDataFetches++;

      try {
        await fetchVideoDataViaApi(videoId);
      } catch (error) {
        console.warn("[ytdl] Failed to fetch video data for", videoId, error);
      } finally {
        activeVideoDataFetches--;
        void processNextVideoData();
      }
    }

    // Observe video data requests arriving via synced signal (postMessage)
    addEventListener("message", e => {
      if (e.data?.namespace !== SYNC_NAMESPACE || e.data?.key !== SyncKey.VideoDataRequest) {
        return;
      }

      const videoId = e.data.value?.mapKey;
      if (!videoId) {
        return;
      }

      if (videoDataCache.has(videoId)) {
        videoDataStore.set(videoId, videoDataCache.get(videoId)!);
        return;
      }

      if (!videoDataPending.has(videoId)) {
        videoDataPending.add(videoId);
        void processNextVideoData();
      }
    });

    // Fetch player data from the android_vr client and resolve format URLs.
    async function fetchPlayerFormats(
      videoId: string,
      downloadType: DownloadType,
      videoItag: number,
      audioItag: number
    ) {
      const visitorData = ytcfg?.get("VISITOR_DATA") ?? "";

      const playerData = await (await globalThis.fetch(
        "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Visitor-Id": String(visitorData)
          },
          body: JSON.stringify({
            videoId,
            context: {
              client: {
                clientName: "ANDROID_VR",
                clientVersion: "1.65.10",
                androidSdkVersion: 34,
                osName: "Android",
                osVersion: "14",
                platform: "MOBILE"
              }
            },
            contentCheckOk: true,
            racyCheckOk: true
          })
        }
      )).json();
      if (playerData.playabilityStatus?.status !== "OK") {
        throw new Error(`Player status: ${playerData.playabilityStatus?.status}`);
      }

      const formats = playerData.streamingData?.adaptiveFormats ?? [];
      const videoFormat = formats.find((format: { itag: number }) => {
        return format.itag === videoItag;
      })
        ?? formats.find((format: { mimeType?: string }) => {
          return format.mimeType?.startsWith("video");
        });
      const audioFormat = formats.find((format: { itag: number }) => {
        return format.itag === audioItag;
      })
        ?? formats.find((format: { mimeType?: string }) => {
          return format.mimeType?.startsWith("audio");
        });

      const videoUrl = downloadType !== "audio" ? videoFormat?.url : null;
      const audioUrl = downloadType !== "video" ? audioFormat?.url : null;
      if (!videoUrl && !audioUrl) {
        throw new Error("No download URLs available");
      }

      return {
        videoUrl,
        audioUrl,
        videoFormat,
        audioFormat
      };
    }

    // Handle direct download requests from the isolated world.
    // Uses the android_vr client (no SABR, no PO token needed) to get
    // direct URLs, fetches video+audio in the MAIN world (YouTube's
    // Service Worker handles CORS), then dispatches via stream-data event.
    addEventListener("message", async e => {
      if (e.data?.namespace !== SYNC_NAMESPACE || e.data.key !== SyncKey.DirectDownloadRequest) {
        return;
      }

      const {
        videoId: downloadVideoId, videoItag, audioItag, filenameOutput, type: downloadType
      } = e.data.value;
      console.log("[ytdl] direct-download-request received:", downloadVideoId);

      cancelActiveDownload(downloadVideoId);
      const abortController = new AbortController();
      activeDownloads.set(downloadVideoId, abortController);
      const { signal } = abortController;

      try {
        const {
          videoUrl, audioUrl, videoFormat, audioFormat
        } = await fetchPlayerFormats(
          downloadVideoId, downloadType, videoItag, audioItag
        );

        let totalExpectedBytes = 0;
        let totalReceivedBytes = 0;

        async function fetchMediaData(url: string, streamType: string) {
          const response = await fetch(url, { signal });
          if (!response.ok) {
            throw new Error(`Media fetch failed: ${response.status}`);
          }

          const contentLength = Number(response.headers.get("content-length") ?? 0);
          totalExpectedBytes += contentLength;

          if (!response.body) {
            return new Uint8Array(await response.arrayBuffer());
          }

          const reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          let receivedBytes = 0;

          while (true) {
            if (signal.aborted) {
              await reader.cancel();
              return null;
            }

            const { done, value } = await reader.read();
            if (done) {
              break;
            }

            chunks.push(value);
            receivedBytes += value.byteLength;
            totalReceivedBytes += value.byteLength;

            // Report progress via synced signal
            if (totalExpectedBytes > 0) {
              postMessage({
                namespace: SYNC_NAMESPACE,
                key: SyncKey.DownloadProgress,
                value: {
                  mapKey: downloadVideoId,
                  mapValue: {
                    isDownloading: true,
                    isDone: false,
                    isQueued: false,
                    progress: totalReceivedBytes / totalExpectedBytes,
                    progressType: streamType
                  }
                }
              }, location.origin);
            }
          }

          const result = new Uint8Array(receivedBytes);
          let writeOffset = 0;

          for (const chunk of chunks) {
            result.set(chunk, writeOffset);
            writeOffset += chunk.byteLength;
          }

          return result;
        }

        const [videoData, audioData] = await Promise.all([
          videoUrl ? fetchMediaData(videoUrl, "video") : Promise.resolve(null),
          audioUrl ? fetchMediaData(audioUrl, "audio") : Promise.resolve(null)
        ]);
        if (signal.aborted) {
          return;
        }

        const videoMimeType = videoFormat?.mimeType?.split(";")?.[0] ?? "video/mp4";
        const audioMimeType = audioFormat?.mimeType?.split(";")?.[0] ?? "audio/mp4";

        postMessage({
          namespace: SYNC_NAMESPACE,
          key: SyncKey.StreamData,
          value: {
            downloadType,
            videoId: downloadVideoId,
            filenameOutput,
            videoData: videoData ?? null,
            audioData: audioData ?? null,
            videoMimeType,
            audioMimeType,
            audioLabel: "",
            additionalAudioData: []
          }
        }, location.origin);
      } catch (error) {
        if (signal.aborted) {
          return;
        }

        console.error("[ytdl] Direct download failed:", error);
        void crossWorldMessenger.sendMessage(
          CrossWorldMessage.StreamError, {
            videoId: downloadVideoId,
            error: String(error)
          }
        );
      } finally {
        activeDownloads.delete(downloadVideoId);
      }
    });

    if (document.readyState === "complete") {
      await extractAndDispatchVideoData();
    } else {
      addEventListener("load", () => {
        return extractAndDispatchVideoData();
      }, { once: true });
    }
  }
});

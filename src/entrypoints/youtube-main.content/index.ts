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

import { buildVideoData, extractPlayerResponseFromHtml } from "./youtube-api";
import { crossWorldMessenger } from "@/lib/cross-world-messenger";
import { getCompatibleFilename, waitForVisibleElement } from "@/lib/utils";
import {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  IconName,
  type AdaptiveFormatItem,
  type ButtonViewModelData,
  type DownloadRequest,
  type DownloadType,
  type PlayerResponse,
  type ProgressUpdate,
  type VideoData,
  type YtButtonViewModelElement
} from "@/types";
import { SabrStream } from "googlevideo/sabr-stream";
import { buildSabrFormat } from "googlevideo/utils";

declare const ytInitialPlayerResponse: PlayerResponse | undefined;
declare const ytcfg: { get: (key: string) => unknown } | undefined;

interface TpYtIronDropdown extends HTMLElement {
  positionTarget: Element | null;
  horizontalAlign: string;
  verticalAlign: string;
  noOverlap: boolean;
  dynamicAlign: boolean;
  allowOutsideScroll: boolean;
  restoreFocusOnClose: boolean;
  opened: boolean;
  open(): void;
  close(): void;
  refit(): void;
}

interface TpYtPaperProgress extends HTMLElement {
  value: number;
  max: number;
  indeterminate: boolean;
}

declare global {
  interface HTMLElementTagNameMap {
    "tp-yt-iron-dropdown": TpYtIronDropdown;
    "tp-yt-paper-progress": TpYtPaperProgress;
    "ytd-watch-flexy": HTMLElement & { playerData: PlayerResponse | null };
  }
}

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    // ─── Capture infrastructure (document_start) ────────────────────────
    // Patches fetch() and SourceBuffer.appendBuffer BEFORE YouTube loads.

    // ─── Fetch interception ─────────────────────────────────────────────
    // Captures the SABR streaming URL and PO token from the player's own
    // requests so SabrStream can independently fetch the full video.

    let capturedSabrUrl = "";
    let capturedPoToken = "";

    function extractPoTokenFromBytes(bytes: Uint8Array) {
      let offset = 0;

      function readVarint(off: number) {
        let value = 0;
        let shift = 0;
        while (off < bytes.byteLength) {
          const byte = bytes[off++];
          value |= (byte & 0x7f) << shift;

          if ((byte & 0x80) === 0) {
            break;
          }

          shift += 7;
        }
        return { value: value >>> 0, offset: off };
      }

      // Find field 19 (StreamerContext) - tag = (19 << 3) | 2 = 154
      while (offset < bytes.byteLength) {
        const tag = readVarint(offset);
        offset = tag.offset;
        const fieldNumber = tag.value >> 3;
        const wireType = tag.value & 0x7;
        if (wireType === 2) {
          const length = readVarint(offset);
          offset = length.offset;

          if (fieldNumber === 19) {
            // Parse StreamerContext for field 2 (poToken)
            const contextData = bytes.subarray(offset, offset + length.value);
            let contextOffset = 0;
            while (contextOffset < contextData.byteLength) {
              const contextTag = readVarint(contextOffset);
              contextOffset = contextTag.offset;
              const contextField = contextTag.value >> 3;
              const contextWire = contextTag.value & 0x7;
              if (contextWire === 2) {
                const contextLength = readVarint(contextOffset);
                contextOffset = contextLength.offset;

                if (contextField === 2 && contextLength.value > 0) {
                  const poTokenBytes = contextData.subarray(
                    contextOffset, contextOffset + contextLength.value
                  );
                  return btoa(String.fromCharCode(...poTokenBytes));
                }

                contextOffset += contextLength.value;
              } else if (contextWire === 0) {
                contextOffset = readVarint(contextOffset).offset;
              } else {
                break;
              }
            }
          }

          offset += length.value;
        } else if (wireType === 0) {
          offset = readVarint(offset).offset;
        } else if (wireType === 1) {
          offset += 8;
        } else if (wireType === 5) {
          offset += 4;
        } else {
          break;
        }
      }

      return null;
    }

    const originalFetch = globalThis.fetch.bind(globalThis);

    function tryExtractPoToken(body: ArrayBuffer | ArrayBufferView | null) {
      if (!body) {
        return;
      }

      try {
        const bodyBytes = body instanceof ArrayBuffer
          ? new Uint8Array(body)
          : new Uint8Array(body.buffer, body.byteOffset, body.byteLength);

        const token = extractPoTokenFromBytes(bodyBytes);
        if (token) {
          capturedPoToken = token;
        }
      } catch {
        // Ignore parsing errors - keep previously captured token
      }
    }

    // Patch XMLHttpRequest - YouTube's player uses XHR for SABR requests
    const originalXhrOpen = XMLHttpRequest.prototype.open;
    const originalXhrSend = XMLHttpRequest.prototype.send;
    const xhrUrlMap = new WeakMap<XMLHttpRequest, string>();

    XMLHttpRequest.prototype.open = function (
      method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null
    ) {
      const urlString = typeof url === "string" ? url : url.href;
      if (method === "POST" && urlString.includes("googlevideo.com/videoplayback")) {
        xhrUrlMap.set(this, urlString);
      }

      return originalXhrOpen.call(this, method, url, async ?? true, username, password);
    };

    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      const sabrUrl = xhrUrlMap.get(this);
      if (sabrUrl) {
        capturedSabrUrl = sabrUrl;
        xhrUrlMap.delete(this);

        if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
          tryExtractPoToken(body);
        }
      }

      return originalXhrSend.call(this, body);
    };

    // Also patch fetch for future-proofing (YouTube may switch to fetch)
    function getUrlFromFetchInput(input: RequestInfo | URL) {
      if (typeof input === "string") {
        return input;
      }

      return input instanceof URL ? input.href : input.url;
    }

    globalThis.fetch = function (input, init) {
      if (init?.method === "POST") {
        const url = getUrlFromFetchInput(input);
        if (url.includes("googlevideo.com/videoplayback")) {
          capturedSabrUrl = url;
          const { body } = init;
          if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
            tryExtractPoToken(body);
          }
        }
      }

      return originalFetch.call(globalThis, input, init);
    };

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

    function createSabrStream(sabrConfig: NonNullable<VideoData["sabrConfig"]>) {
      const sabrFormats = sabrConfig.formats.map(adaptiveFormatToSabrFormat);
      const durationMs = parseInt(sabrConfig.formats[0]?.approxDurationMs ?? "0");

      return new SabrStream({
        fetch: originalFetch,
        serverAbrStreamingUrl: capturedSabrUrl || sabrConfig.serverAbrStreamingUrl,
        videoPlaybackUstreamerConfig: sabrConfig.videoPlaybackUstreamerConfig,
        poToken: capturedPoToken,
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

      return { videoData, audioData };
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
    MediaSource.prototype.addSourceBuffer = function (mimeType: string) {
      const sourceBuffer = originalAddSourceBuffer.call(this, mimeType);
      if (mimeType.startsWith("video") || mimeType.startsWith("audio")) {
        sourceBufferMimeTypes.set(sourceBuffer, mimeType);
      }

      return sourceBuffer;
    };

    // Buffer data before activeVideoId is set (init segments arrive early)
    const pendingChunks: Array<{ mimeType: string; data: Uint8Array }> = [];

    const originalAppendBuffer = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function (data: BufferSource) {
      const mimeType = sourceBufferMimeTypes.get(this);
      if (mimeType) {
        let chunk: Uint8Array;
        if (data instanceof ArrayBuffer) {
          chunk = new Uint8Array(data);
        } else if (data instanceof Uint8Array) {
          chunk = data;
        } else {
          chunk = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        }

        if (!activeVideoId || !capturedMedia.has(activeVideoId)) {
          pendingChunks.push({ mimeType, data: chunk.slice() });
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
      return { clientVersion, clientName };
    }

    function buildAndDispatchVideoData(playerResponse: PlayerResponse) {
      const { clientVersion, clientName } = readYtcfg();
      const videoData: VideoData = buildVideoData(playerResponse, clientVersion, clientName);
      videoDataCache.set(videoData.videoId, videoData);
      crossWorldMessenger.sendMessage("videoData", videoData);

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
        injectSegmentedDownloadButton(videoData);
      }
    }

    function extractAndDispatchVideoData() {
      const playerResponse = ytInitialPlayerResponse ?? null;
      if (!playerResponse || !location.pathname.startsWith("/watch")) {
        return;
      }

      buildAndDispatchVideoData(playerResponse);
    }

    // - Download handler -
    // Fetches full video and audio streams directly from YouTube's CDN using
    // the pre-signed URLs in AdaptiveFormatItem, then posts to isolated world.

    async function fetchStreamFromUrl(url: string) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} fetching stream`);
      }

      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
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

    function dispatchStreamData(
      type: DownloadType,
      videoId: string,
      filenameOutput: string,
      videoData: Uint8Array | null,
      audioData: Uint8Array | null,
      videoMimeType: string,
      audioMimeType: string,
      audioLabel: string,
      additionalAudioData: Array<{ data: Uint8Array | null; mimeType: string; label: string }>
    ) {
      dispatchEvent(new CustomEvent("ytdl:stream-data", {
        detail: {
          downloadType: type,
          videoId,
          filenameOutput,
          videoData,
          audioData,
          videoMimeType,
          audioMimeType,
          audioLabel,
          additionalAudioData
        }
      }));
    }

    function dispatchStreamError(videoId: string, error: string) {
      dispatchEvent(new CustomEvent("ytdl:stream-error", { detail: { videoId, error } }));
    }

    async function performDownload({
      type,
      videoId,
      videoItag,
      audioItag,
      filenameOutput
    }: Pick<DownloadRequest, "type" | "videoId" | "videoItag" | "audioItag" | "filenameOutput">) {
      const cachedVideoData = videoDataCache.get(videoId);
      if (!cachedVideoData) {
        console.error("[ytdl] No video data cached for", videoId);
        return;
      }

      const videoFormat = type !== "audio"
        ? (cachedVideoData.videoFormats.find(format => format.itag === videoItag) ?? cachedVideoData.videoFormats[0])
        : null;
      const audioFormat = type !== "video"
        ? (cachedVideoData.audioFormats.find(format => format.itag === audioItag) ?? cachedVideoData.audioFormats[0])
        : null;

      const videoMimeType = videoFormat?.mimeType.split(";")[0] ?? "video/mp4";
      const audioMimeType = audioFormat?.mimeType.split(";")[0] ?? "audio/mp4";
      const audioLabel = audioFormat?.audioTrack?.displayName ?? "";
      const extraAudioFormats = getExtraAudioFormats(
        cachedVideoData.audioFormats, audioFormat?.audioTrack?.id
      );
      // Strategy 1: SabrStream - independently fetch the full video without
      // relying on playback state. Works even if the video is paused.
      readSabrCredentialsFromDom();
      console.log("[ytdl] Download state:", { hasSabrUrl: !!capturedSabrUrl, hasPoToken: !!capturedPoToken, hasSabrConfig: !!cachedVideoData.sabrConfig });
      const hasSabrCredentials = capturedPoToken && capturedSabrUrl;
      if (hasSabrCredentials && cachedVideoData.sabrConfig && videoFormat && audioFormat) {
        try {
          console.log("[ytdl] Fetching via SabrStream (independent of playback)");

          const primaryResult = await fetchViaSabrStream(
            cachedVideoData.sabrConfig, videoFormat, audioFormat
          );

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

          dispatchStreamData(
            type, videoId, filenameOutput,
            type !== "audio" ? primaryResult.videoData : null,
            type !== "video" ? primaryResult.audioData : null,
            videoMimeType, audioMimeType, audioLabel,
            additionalAudioData.filter((track): track is NonNullable<typeof track> => track !== null)
          );

          capturedMedia.delete(videoId);
          document.dispatchEvent(new CustomEvent("ytdl:clear-interrupted", { detail: { videoId } }));
          return;
        } catch (sabrError) {
          console.warn("[ytdl] SabrStream failed, trying fallback:", sabrError);
          document.dispatchEvent(new CustomEvent("ytdl:persist-interrupted", {
            detail: {
              videoId, type, filenameOutput, videoItag, audioItag, timestamp: Date.now()
            }
          }));
        }
      }

      // Strategy 2: Direct CDN fetch - formats include pre-signed URLs.
      const hasDirectUrls = (videoFormat?.url) || (audioFormat?.url);
      if (hasDirectUrls) {
        try {
          const [videoBytes, audioBytes, ...extraAudioBytes] = await Promise.all([
            videoFormat?.url ? fetchStreamFromUrl(videoFormat.url) : Promise.resolve(null),
            audioFormat?.url ? fetchStreamFromUrl(audioFormat.url) : Promise.resolve(null),
            ...extraAudioFormats.map(format =>
              format.url ? fetchStreamFromUrl(format.url) : Promise.resolve(null)
            )
          ]);

          const additionalAudioData = extraAudioFormats.map((format, iTrack) => ({
            data: extraAudioBytes[iTrack] ?? null,
            mimeType: format.mimeType.split(";")[0] ?? "audio/mp4",
            label: format.audioTrack?.displayName ?? `Track ${iTrack + 2}`
          }));

          dispatchStreamData(
            type, videoId, filenameOutput,
            videoBytes, audioBytes,
            videoMimeType, audioMimeType, audioLabel,
            additionalAudioData
          );
          return;
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

        dispatchStreamData(
          type, videoId, filenameOutput,
          videoBytes, audioBytes,
          capture.videoMimeType, capture.audioMimeType, audioLabel, []
        );

        capturedMedia.delete(videoId);
        return;
      }

      // All strategies failed - persist as interrupted so user can resume later
      document.dispatchEvent(new CustomEvent("ytdl:persist-interrupted", {
        detail: {
          videoId, type, filenameOutput, videoItag, audioItag, timestamp: Date.now()
        }
      }));

      dispatchStreamError(videoId, "No download method available - try reloading the page");
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

    async function findVideoActionsContainer() {
      for (const selector of VIDEO_ACTION_BUTTON_SELECTORS) {
        const element = await Promise.race([
          waitForVisibleElement(selector),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 3000))
        ]);
        if (element) {
          return element;
        }
      }
      return null;
    }

    function cleanupSegmentedButton() {
      cleanupCurrentButton?.();
      cleanupCurrentButton = null;
    }

    async function injectSegmentedDownloadButton(videoData: VideoData) {
      cleanupSegmentedButton();
      const generation = ++injectionGeneration;

      const elActionsContainer = await findVideoActionsContainer();
      if (!elActionsContainer || generation !== injectionGeneration) {
        return;
      }

      const { videoId } = videoData;
      const defaultExtension = videoData.isMusic ? "mp3" : "mp4";
      let defaultFilename = getCompatibleFilename(
        `${videoData.title}.${defaultExtension}`
      );
      let defaultQuality = "";
      let defaultVideoItag = videoData.videoFormats[0]?.itag ?? 0;
      let defaultAudioItag = videoData.audioFormats[0]?.itag ?? 0;
      const defaultDownloadType: DownloadType = videoData.isMusic ? "audio" : "video+audio";

      let isDownloading = false;
      let isDone = false;
      let isInterrupted = false;
      let isPanelOpen = false;
      let downloadProgress = 0;

      // Check for interrupted download from a previous session
      const elInterrupted = document.getElementById("ytdl-interrupted");
      if (elInterrupted?.dataset.videoId === videoId) {
        isInterrupted = true;
        defaultVideoItag = parseInt(elInterrupted.dataset.videoItag ?? "0") || defaultVideoItag;
        defaultAudioItag = parseInt(elInterrupted.dataset.audioItag ?? "0") || defaultAudioItag;
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
        elNativeDownload.setAttribute("style", "display: none");
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
      const elGroup = document.createElement("div");
      elGroup.setAttribute("data-ytdl-download-group", "true");
      elGroup.setAttribute("style", "display: flex; align-items: center; margin-left: 8px; position: relative; overflow: hidden;");

      const elDownloadButton = document.createElement("yt-button-view-model");
      const elChevronButton = document.createElement("yt-button-view-model");

      const elProgressBar = document.createElement("tp-yt-paper-progress");
      elProgressBar.setAttribute("style", "position: absolute; bottom: 0; left: 0; right: 0; height: 2px; pointer-events: none; z-index: 1; opacity: 0");

      elGroup.append(elDownloadButton, elChevronButton, elProgressBar);

      // Polymer's Shady DOM requires updateStyles for CSS custom properties
      if ("updateStyles" in elProgressBar && typeof elProgressBar.updateStyles === "function") {
        elProgressBar.updateStyles({
          "--paper-progress-active-color": "var(--yt-spec-call-to-action, rgb(62 166 255))",
          "--paper-progress-container-color": "transparent"
        });
      }

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
      elDropdownContentSlot.setAttribute("slot", "dropdown-content");
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

      // Notify the isolated world where to mount the Svelte panel
      crossWorldMessenger.sendMessage("panelContentReady", { contentId: panelContentId });

      // Set Polymer scoping class and data AFTER insertion so connectedCallback
      // does not wipe the class attribute
      elDownloadButton.setAttribute("class", scopingClass);
      elDownloadButton.setAttribute("data-ytdl-download", "true");
      elDownloadButton.data = buildDownloadData();

      elChevronButton.setAttribute("class", scopingClass);
      // Suppress the automatic margin-left that YouTube's CSS would add between
      // adjacent yt-button-view-model siblings - the two buttons must sit flush.
      elChevronButton.setAttribute("style", "margin-left: 0 !important");
      elChevronButton.setAttribute("data-ytdl-chevron", "true");
      elChevronButton.data = buildChevronData();

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
      segmentedObserver.observe(elDownloadButton, { childList: true, subtree: true });
      segmentedObserver.observe(elChevronButton, { childList: true, subtree: true });
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
        const target = e.target;
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
            crossWorldMessenger.sendMessage("cancelDownload", { videoIds: [videoId] });
          } else {
            isDone = false;
            isInterrupted = false;
            isDownloading = true;
            downloadProgress = 0;
            refreshButtons();
            performDownload({
              type: defaultDownloadType,
              videoId,
              videoItag: defaultVideoItag,
              audioItag: defaultAudioItag,
              filenameOutput: defaultFilename
            });
          }

          return;
        }

        if (elChevronButton.contains(target)) {
          if (!videoData.isDownloadable) {
            return;
          }

          isPanelOpen = !isPanelOpen;
          refreshButtons();

          if (isPanelOpen) {
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

      const unsubscribeProgress = crossWorldMessenger.onMessage("progress", handleProgress);
      const unsubscribePanelClosed = crossWorldMessenger.onMessage("panelClosed", () => handlePanelClosed());
      const unsubscribeFilenameChanged = crossWorldMessenger.onMessage("filenameChanged", ({ data }) => {
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
        unsubscribePanelClosed();
        unsubscribeFilenameChanged();
        elDropdown.removeEventListener("iron-overlay-closed", handleDropdownClosed);
        elGroup.remove();
        elDropdown.remove();
        elNativeDownload?.removeAttribute("style");
      };
    }

    // - Navigation handling -
    // yt-navigate-finish fires first but ytInitialPlayerResponse is still stale.
    // yt-page-data-updated fires after and ytd-watch-flexy.playerData has the fresh response.

    function handleNavigation() {
      cleanupSegmentedButton();
      crossWorldMessenger.sendMessage("navigation", { url: location.href });
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
    const gridDropdowns = new Map<string, TpYtIronDropdown>();

    document.addEventListener("ytdl:create-dropdown", (e: Event) => {
      if (!(e instanceof CustomEvent)) {
        return;
      }

      const { contentId, positionTargetSelector } = e.detail;
      const elPositionTarget = document.querySelector(positionTargetSelector);
      if (!elPositionTarget) {
        return;
      }

      const elDropdownContentSlot = document.createElement("ytd-menu-popup-renderer");
      elDropdownContentSlot.setAttribute("slot", "dropdown-content");
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

      gridDropdowns.set(contentId, elDropdown);
    });

    document.addEventListener("ytdl:open-dropdown", (e: Event) => {
      if (!(e instanceof CustomEvent)) {
        return;
      }

      const elDropdown = gridDropdowns.get(e.detail.contentId);
      if (elDropdown) {
        elDropdown.open();
      }
    });

    document.addEventListener("ytdl:close-dropdown", (e: Event) => {
      if (!(e instanceof CustomEvent)) {
        return;
      }

      const { videoId: dropdownVideoId } = e.detail;
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

      if ("receivedFocusFromKeyboard" in elDropdown && elDropdown.receivedFocusFromKeyboard) {
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

    document.addEventListener("yt-navigate-finish", handleNavigation);

    async function handlePageDataUpdated(e: Event) {
      if (!(e instanceof CustomEvent)) {
        return;
      }

      const { pageType }: { pageType?: string } = e.detail;
      if (pageType !== "watch") {
        return;
      }

      const playerResponse = document.querySelector("ytd-watch-flexy")?.playerData ?? null;
      if (!playerResponse) {
        return;
      }

      buildAndDispatchVideoData(playerResponse);
    }

    document.addEventListener("yt-page-data-updated", handlePageDataUpdated);

    // Read SABR credentials from DOM element set by the isolated world.
    // The isolated world stores credentials in #ytdl-sabr-credentials dataset
    // because CustomEvents don't reliably cross the isolated/MAIN world boundary.
    function readSabrCredentialsFromDom() {
      const elCredentials = document.getElementById("ytdl-sabr-credentials");
      if (!elCredentials?.dataset.url || !elCredentials.dataset.poToken) {
        return;
      }

      capturedSabrUrl = elCredentials.dataset.url;
      capturedPoToken = elCredentials.dataset.poToken;
    }

    // Poll for credentials (isolated world sets them asynchronously)
    const credentialObserver = new MutationObserver(() => {
      readSabrCredentialsFromDom();

      if (capturedPoToken) {
        credentialObserver.disconnect();
        console.log("[ytdl] SABR credentials received from background");
      }
    });

    credentialObserver.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["data-url", "data-po-token"]
    });

    // Handle download requests from Svelte panel components (via isolated world)
    crossWorldMessenger.onMessage("downloadRequest", async ({ data }) => {
      await performDownload(data);
    });

    // Handle video data requests from playlist items (via isolated world)
    crossWorldMessenger.onMessage("requestVideoData", async ({ data }) => {
      const { videoId } = data;
      if (videoDataCache.has(videoId)) {
        crossWorldMessenger.sendMessage("videoData", videoDataCache.get(videoId)!);
        return;
      }

      try {
        const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
        const html = await response.text();
        const playerResponse = extractPlayerResponseFromHtml(html);
        if (playerResponse) {
          buildAndDispatchVideoData(playerResponse);
        }
      } catch {
        // Silently fail - PlaylistVideoItem shows loading indicator
      }
    });

    if (document.readyState === "complete") {
      extractAndDispatchVideoData();
    } else {
      addEventListener("load", extractAndDispatchVideoData, { once: true });
    }
  }
});

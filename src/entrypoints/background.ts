import { MessageType, onMessage, sendMessage } from "../lib/messaging";
import {
  clearCapturedSabrData,
  extractPoTokenFromBody,
  getCapturedSabrData,
  onSabrBodyCaptured,
  startSabrRequestCapture
} from "../lib/sabr-request-capture";
import { clearLocalStorage, interruptedDownloadsItem, isFFmpegReadyItem, statusProgressItem } from "../lib/storage";
import type { DownloadType } from "../types";

export default defineBackground(() => {
  startSabrRequestCapture();
  onSabrBodyCaptured(tabId => {
    // Content script might not be ready yet during initial page load.
    // Send notification and silently ignore connection errors.
    sendMessage(MessageType.SabrBodyReady, {}, tabId).catch(() => {});
  });

  // - Tab tracking -

  const videoIdToTabIds: Record<string, number[]> = {};
  const tabTracker: Record<number, { videoIdsAvailable: string[] }> = {};

  function trackVideoForTab(videoId: string, tabId: number) {
    if (!videoIdToTabIds[videoId]) {
      videoIdToTabIds[videoId] = [tabId];
    } else if (!videoIdToTabIds[videoId].includes(tabId)) {
      videoIdToTabIds[videoId].push(tabId);
    }
  }

  function untrackVideoForTab(videoId: string, tabId: number) {
    if (!videoIdToTabIds[videoId]) {
      return;
    }

    videoIdToTabIds[videoId] = videoIdToTabIds[videoId].filter(id => id !== tabId);
  }

  // - Offscreen document management (Chrome only) -

  let offscreenDocumentPromise: Promise<void> | null = null;

  function ensureOffscreenDocument() {
    if (import.meta.env.FIREFOX) {
      return Promise.resolve();
    }

    if (offscreenDocumentPromise) {
      return offscreenDocumentPromise;
    }

    offscreenDocumentPromise = (async () => {
      let existingContexts: Browser.runtime.ExtensionContext[] = [];
      try {
        const contextTypes = [browser.runtime.ContextType.OFFSCREEN_DOCUMENT];
        existingContexts = await browser.runtime.getContexts({ contextTypes });
      } catch {
        // getContexts not available in all environments
      }

      if (existingContexts.length > 0) {
        return;
      }

      await browser.offscreen.createDocument({
        url: "/offscreen.html",
        reasons: [browser.offscreen.Reason.WORKERS],
        justification: "FFmpeg WASM processing requires a Worker context"
      });
    })();

    return offscreenDocumentPromise;
  }

  // - Chunk forwarding (Chrome only) -

  if (!import.meta.env.FIREFOX) {
    ensureOffscreenDocument();

    // Receive chunk from content script, forward to offscreen for accumulation.
    // 1 MB per message stays well under the runtime.sendMessage size limit.
    onMessage(MessageType.StreamChunk, async ({ data, sender }) => {
      const tabId = sender.tab?.id;
      if (!tabId) {
        console.warn("[ytdl:bg] streamChunk: no tabId");
        return;
      }

      await ensureOffscreenDocument();
      await sendMessage(MessageType.ProcessStreamChunk, { ...data, tabId });
    });

    // Receive stream-end signal, track tab, forward to offscreen for FFmpeg muxing.
    onMessage(MessageType.StreamEnd, async ({ data, sender }) => {
      const tabId = sender.tab?.id;
      if (!tabId) {
        return;
      }

      trackVideoForTab(data.videoId, tabId);

      tabTracker[tabId] ??= { videoIdsAvailable: [] };

      if (!tabTracker[tabId].videoIdsAvailable.includes(data.videoId)) {
        tabTracker[tabId].videoIdsAvailable.push(data.videoId);
      }

      await ensureOffscreenDocument();
      await sendMessage(MessageType.ProcessStreamEnd, { ...data, tabId });
    });
  }

  // - Firefox: eager FFmpeg init + chunk accumulation -

  if (import.meta.env.FIREFOX) {
    async function initFirefoxPipeline() {
      const { initFFmpeg } = await import("../lib/download-pipeline");
      initFFmpeg(
        browser.runtime.getURL("/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js"),
        browser.runtime.getURL("/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm"),
        browser.runtime.getURL("/node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js")
      );
    }

    initFirefoxPipeline();

    interface FirefoxAudioStream {
      chunks: Map<number, Uint8Array>;
      totalChunks: number;
    }

    interface FirefoxStreamAccumulator {
      videoChunks: Map<number, Uint8Array>;
      totalVideoChunks: number;
      // Key: "audio", "audio-extra-0", "audio-extra-1", ...
      audioStreams: Map<string, FirefoxAudioStream>;
    }

    // Firefox has no offscreen document - accumulate chunks here, then call
    // enqueueStreamData directly once all chunks for a video have arrived.
    const streamAccumulators = new Map<string, FirefoxStreamAccumulator>();

    function assembleStreamChunks(
      chunks: Map<number, Uint8Array>,
      totalChunks: number
    ) {
      if (totalChunks === 0) {
        return null;
      }

      const totalBytes = Array.from(chunks.values())
        .reduce((sum, chunk) => sum + chunk.byteLength, 0);
      const result = new Uint8Array(totalBytes);
      let offset = 0;

      for (let iChunk = 0; iChunk < totalChunks; iChunk++) {
        const chunk = chunks.get(iChunk);
        if (!chunk) {
          continue;
        }

        result.set(chunk, offset);
        offset += chunk.byteLength;
      }

      return result;
    }

    onMessage(MessageType.StreamChunk, ({ data, sender }) => {
      const tabId = sender.tab?.id;
      if (!tabId) {
        return;
      }

      const {
        videoId, streamType, iChunk, totalChunks, chunkBase64
      } = data;
      if (!streamAccumulators.has(videoId)) {
        streamAccumulators.set(videoId, {
          videoChunks: new Map(),
          totalVideoChunks: 0,
          audioStreams: new Map()
        });
      }

      const accumulator = streamAccumulators.get(videoId)!;
      const binaryString = atob(chunkBase64);
      const normalizedChunk = Uint8Array.from(binaryString, char => char.charCodeAt(0));
      if (streamType === "video") {
        accumulator.videoChunks.set(iChunk, normalizedChunk);
        accumulator.totalVideoChunks = totalChunks;
      } else {
        if (!accumulator.audioStreams.has(streamType)) {
          accumulator.audioStreams.set(streamType, { chunks: new Map(), totalChunks: 0 });
        }

        const audioStream = accumulator.audioStreams.get(streamType)!;
        audioStream.chunks.set(iChunk, normalizedChunk);
        audioStream.totalChunks = totalChunks;
      }
    });

    onMessage(MessageType.StreamEnd, async ({ data, sender }) => {
      const tabId = sender.tab?.id;
      if (!tabId) {
        return;
      }

      const {
        videoId, type, filenameOutput, videoMimeType, audioMimeType, audioTrackLabels,
        playlistId, playlistTitle, playlistTotalCount
      } = data;
      trackVideoForTab(videoId, tabId);

      if (!tabTracker[tabId]) {
        tabTracker[tabId] = { videoIdsAvailable: [videoId] };
      } else if (!tabTracker[tabId].videoIdsAvailable.includes(videoId)) {
        tabTracker[tabId].videoIdsAvailable.push(videoId);
      }

      const accumulator = streamAccumulators.get(videoId);
      streamAccumulators.delete(videoId);

      const primaryAudio = accumulator?.audioStreams.get("audio");
      const extraTrackLabels = audioTrackLabels.slice(1);
      const additionalAudioStreams = extraTrackLabels.map((label, iTrack) => {
        const audioStream = accumulator?.audioStreams.get(`audio-extra-${iTrack}`);
        return {
          data: audioStream
            ? assembleStreamChunks(audioStream.chunks, audioStream.totalChunks)
            : null,
          mimeType: audioMimeType,
          label
        };
      });

      const { enqueueStreamData } = await import("../lib/download-pipeline");
      enqueueStreamData({
        type,
        videoId,
        filenameOutput,
        videoData: accumulator
          ? assembleStreamChunks(accumulator.videoChunks, accumulator.totalVideoChunks)
          : null,
        audioData: primaryAudio
          ? assembleStreamChunks(primaryAudio.chunks, primaryAudio.totalChunks)
          : null,
        videoMimeType,
        audioMimeType,
        primaryAudioLabel: audioTrackLabels[0],
        additionalAudioStreams,
        tabId,
        playlistId,
        playlistTitle,
        playlistTotalCount
      });
    });
  }

  async function cancelDownloads(videoIds: string[]) {
    if (!import.meta.env.FIREFOX) {
      await sendMessage(MessageType.CancelProcessing, { videoIds });
    } else {
      const { cancelDownloadsByIds } = await import("../lib/download-pipeline");
      await cancelDownloadsByIds(videoIds);
    }
  }

  // - Message handlers -

  onMessage(MessageType.ProxyFetch, async ({ data }) => {
    const fetchUrl = "url" in data ? String(data.url) : "";
    const bodyBase64 = "bodyBase64" in data ? String(data.bodyBase64) : "";

    try {
      const bodyBytes = Uint8Array.from(atob(bodyBase64), character => character.charCodeAt(0));

      // Include YouTube session cookies - googlevideo.com needs them for auth
      const youtubeCookies = await browser.cookies.getAll({ domain: ".youtube.com" });
      const googlevideoCookies = await browser.cookies.getAll({ domain: ".googlevideo.com" });
      const allCookies = [...youtubeCookies, ...googlevideoCookies];
      const cookieString = allCookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ");

      const response = await fetch(fetchUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-protobuf",
          accept: "application/vnd.yt-ump",
          origin: "https://www.youtube.com",
          cookie: cookieString
        },
        body: bodyBytes
      });

      const responseBuffer = await response.arrayBuffer();
      const responseBytes = new Uint8Array(responseBuffer);
      let responseBase64 = "";
      const batchSize = 8192;

      for (let offset = 0; offset < responseBytes.byteLength; offset += batchSize) {
        responseBase64 += String.fromCharCode(
          ...responseBytes.subarray(offset, Math.min(offset + batchSize, responseBytes.byteLength))
        );
      }

      return { status: response.status, bodyBase64: btoa(responseBase64) };
    } catch (error) {
      console.error("[ytdl:bg] proxyFetch error:", error);
      return null;
    }
  });

  onMessage(MessageType.DirectDownload, async ({ data, sender }) => {
    const tabId = sender.tab?.id ?? 0;

    const {
      videoId, videoUrl, audioUrl, filenameOutput,
      videoMimeType, audioMimeType, type: downloadType
    } = data as {
      videoId: string;
      videoUrl: string | null;
      audioUrl: string | null;
      filenameOutput: string;
      videoMimeType: string;
      audioMimeType: string;
      type: DownloadType;
    };

    try {
      async function fetchStream(url: string) {
        const headers = { "Accept-Encoding": "identity" };
        const response = await fetch(url, { headers });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return new Uint8Array(await response.arrayBuffer());
      }

      const [videoData, audioData] = await Promise.all([
        videoUrl && downloadType !== "audio" ? fetchStream(videoUrl) : Promise.resolve(null),
        audioUrl && downloadType !== "video" ? fetchStream(audioUrl) : Promise.resolve(null)
      ]);
      console.log(`[ytdl:bg] directDownload: video=${videoData?.byteLength ?? 0} audio=${audioData?.byteLength ?? 0}`);

      if (!import.meta.env.FIREFOX) {
        await ensureOffscreenDocument();

        async function sendChunksToOffscreen(streamType: string, streamData: Uint8Array) {
          const chunkSize = 1024 * 1024;
          const totalChunks = Math.ceil(streamData.byteLength / chunkSize);

          for (let iChunk = 0; iChunk < totalChunks; iChunk++) {
            const start = iChunk * chunkSize;
            const chunk = streamData.slice(start, start + chunkSize);
            let base64 = "";
            const batchSize = 8192;

            for (let batchOffset = 0; batchOffset < chunk.byteLength; batchOffset += batchSize) {
              base64 += String.fromCharCode(
                ...chunk.subarray(batchOffset, Math.min(batchOffset + batchSize, chunk.byteLength))
              );
            }

            await sendMessage(MessageType.ProcessStreamChunk, {
              videoId,
              streamType,
              iChunk,
              totalChunks,
              chunkBase64: btoa(base64),
              tabId
            });
          }
        }

        if (videoData) {
          await sendChunksToOffscreen("video", videoData);
        }

        if (audioData) {
          await sendChunksToOffscreen("audio", audioData);
        }

        await sendMessage(MessageType.ProcessStreamEnd, {
          type: downloadType,
          videoId,
          filenameOutput,
          videoMimeType,
          audioMimeType,
          audioTrackLabels: [""],
          tabId
        });
      } else {
        const { enqueueStreamData } = await import("../lib/download-pipeline");
        await enqueueStreamData({
          type: downloadType,
          videoId,
          filenameOutput,
          videoData,
          audioData,
          videoMimeType,
          audioMimeType,
          primaryAudioLabel: "",
          additionalAudioStreams: [],
          tabId
        });
      }

      return true;
    } catch (error) {
      console.error("[ytdl:bg] directDownload failed:", error);
      return false;
    }
  });

  onMessage(MessageType.GetCapturedSabrBody, async ({ sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return null;
    }

    const captured = getCapturedSabrData(tabId);
    if (!captured) {
      return null;
    }

    const poToken = extractPoTokenFromBody(captured.body) ?? "";

    return {
      body: btoa(String.fromCharCode(...captured.body)),
      url: captured.url,
      poToken
    };
  });

  onMessage(MessageType.SabrDownload, async ({ data, sender }) => {
    const { request, poToken } = data;
    const tabId = sender.tab?.id ?? 0;
    console.log("[ytdl:bg] sabrDownload received:", request.videoId, "po:", poToken?.length, "hasSabr:", !!request.sabrConfig);

    if (!request.sabrConfig) {
      console.log("[ytdl:bg] No sabrConfig");
      return false;
    }

    try {
      const { SabrStream } = await import("googlevideo/sabr-stream");
      const { buildSabrFormat } = await import("googlevideo/utils");
      console.log("[ytdl:bg] SabrStream imported, formats:", request.sabrConfig.formats.length);

      const sabrConfig = request.sabrConfig;
      const sabrFormats = sabrConfig.formats.map(format => buildSabrFormat({
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
      }));

      const durationMs = parseInt(sabrConfig.formats[0]?.approxDurationMs ?? "0");
      const videoFormat = sabrFormats.find(format => format.itag === request.videoItag);
      const audioFormat = sabrFormats.find(format => format.itag === request.audioItag);
      if (!videoFormat || !audioFormat) {
        browser.storage.local.set({ ytdlBgDebug: `format not found: v=${request.videoItag}(${!!videoFormat}) a=${request.audioItag}(${!!audioFormat})` });
        return false;
      }

      browser.storage.local.set({ ytdlBgDebug: `starting SabrStream, po=${poToken.substring(0, 20)}...` });

      const sabrStream = new SabrStream({
        fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init?.headers).entries()),
            origin: "https://www.youtube.com",
            referer: "https://www.youtube.com/"
          }
        }),
        serverAbrStreamingUrl: sabrConfig.serverAbrStreamingUrl,
        videoPlaybackUstreamerConfig: sabrConfig.videoPlaybackUstreamerConfig,
        poToken: poToken || undefined,
        clientInfo: {
          clientName: sabrConfig.clientName,
          clientVersion: sabrConfig.clientVersion
        },
        formats: sabrFormats,
        durationMs
      });

      const { videoStream, audioStream } = await sabrStream.start({
        videoFormat,
        audioFormat
      });

      // Collect full streams in memory (no CORS issues in background)
      async function collectStream(stream: ReadableStream<Uint8Array>) {
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
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return result;
      }

      const [videoData, audioData] = await Promise.all([
        collectStream(videoStream),
        collectStream(audioStream)
      ]);

      const videoMimeType = sabrConfig.formats.find(
        format => format.itag === request.videoItag
      )?.mimeType.split(";")[0] ?? "video/mp4";

      const audioMimeType = sabrConfig.formats.find(
        format => format.itag === request.audioItag
      )?.mimeType.split(";")[0] ?? "audio/mp4";
      // Feed directly into the pipeline (bypass chunk relay)
      if (!import.meta.env.FIREFOX) {
        await ensureOffscreenDocument();

        // Send chunks to offscreen
        async function sendChunksToOffscreen(streamType: string, streamData: Uint8Array) {
          const chunkSize = 1024 * 1024;
          const totalChunks = Math.ceil(streamData.byteLength / chunkSize);
          for (let iChunk = 0; iChunk < totalChunks; iChunk++) {
            const start = iChunk * chunkSize;
            const chunk = streamData.slice(start, start + chunkSize);
            let base64 = "";
            const batchSize = 8192;
            for (let batchOffset = 0; batchOffset < chunk.byteLength; batchOffset += batchSize) {
              base64 += String.fromCharCode(
                ...chunk.subarray(batchOffset, Math.min(batchOffset + batchSize, chunk.byteLength))
              );
            }
            await sendMessage(MessageType.ProcessStreamChunk, {
              videoId: request.videoId,
              streamType,
              iChunk,
              totalChunks,
              chunkBase64: btoa(base64),
              tabId
            });
          }
        }

        if (request.type !== "audio" && videoData.byteLength > 0) {
          await sendChunksToOffscreen("video", videoData);
        }

        if (request.type !== "video" && audioData.byteLength > 0) {
          await sendChunksToOffscreen("audio", audioData);
        }

        await sendMessage(MessageType.ProcessStreamEnd, {
          type: request.type,
          videoId: request.videoId,
          filenameOutput: request.filenameOutput,
          videoMimeType,
          audioMimeType,
          audioTrackLabels: [""],
          tabId
        });
      } else {
        // Firefox: process directly in background
        const { enqueueStreamData } = await import("../lib/download-pipeline");
        await enqueueStreamData({
          videoId: request.videoId,
          filenameOutput: request.filenameOutput,
          type: request.type,
          videoData: request.type !== "audio" ? videoData : null,
          audioData: request.type !== "video" ? audioData : null,
          videoMimeType,
          audioMimeType,
          primaryAudioLabel: "",
          additionalAudioStreams: [],
          tabId
        });
      }

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[ytdl:bg] SabrStream download failed:", errorMessage);
      browser.storage.local.set({ ytdlBgDebug: `error: ${errorMessage}` });
      return false;
    }
  });

  onMessage(MessageType.PersistInterruptedDownload, async ({ data }) => {
    const current = await interruptedDownloadsItem.getValue();
    current[data.videoId] = data;
    await interruptedDownloadsItem.setValue(current);
  });

  onMessage(MessageType.ClearInterruptedDownload, async ({ data }) => {
    const current = await interruptedDownloadsItem.getValue();
    delete current[data.videoId];
    await interruptedDownloadsItem.setValue(current);
  });

  onMessage(MessageType.GetInterruptedDownload, async ({ data }) => {
    const current = await interruptedDownloadsItem.getValue();
    return current[data.videoId] ?? null;
  });

  onMessage(MessageType.ProcessStreamError, async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return;
    }

    console.error("[ytdl] Stream error for", data.videoId, data.error);
    await sendMessage(
      MessageType.UpdateDownloadProgress,
      {
        videoId: data.videoId,
        progress: 0,
        progressType: "video",
        isRemoved: true
      },
      tabId
    );
  });

  onMessage(MessageType.RequestPlaylistDownload, async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return;
    }

    for (const item of data.items) {
      await sendMessage(MessageType.ExecuteDownloadItem, item, tabId);
    }
  });

  onMessage(MessageType.CancelDownload, async ({ data }) => {
    await cancelDownloads(data.videoIds);
  });

  // - Pipeline storage handlers (chrome.storage unavailable in offscreen) -

  onMessage(MessageType.PipelineProgress, async ({ data }) => {
    const {
      videoId, progress, progressType, tabId
    } = data;
    const current = await statusProgressItem.getValue();
    current[videoId] = { progress, progressType };
    await Promise.allSettled([
      sendMessage(MessageType.UpdateDownloadProgress, { videoId, progress, progressType }, tabId),
      statusProgressItem.setValue(current)
    ]);
  });

  onMessage(MessageType.PipelineRemoval, async ({ data }) => {
    const { videoId, tabId } = data;
    const current = await statusProgressItem.getValue();
    delete current[videoId];
    await Promise.allSettled([
      sendMessage(
        MessageType.UpdateDownloadProgress,
        {
          videoId,
          progress: 0,
          progressType: "video",
          isRemoved: true
        },
        tabId
      ),
      statusProgressItem.setValue(current)
    ]);
  });

  onMessage(MessageType.PipelineQueueRemove, async ({ data }) => {
    const { videoId } = data;
    const current = await statusProgressItem.getValue();
    delete current[videoId];
    await statusProgressItem.setValue(current);
  });

  onMessage(MessageType.PipelineFFmpegReady, async () => {
    await isFFmpegReadyItem.setValue(true);
  });

  onMessage(MessageType.PipelineDownload, async ({ data }) => {
    await browser.downloads.download({
      url: data.blobUrl,
      filename: data.filename
    });
  });

  // - Tab lifecycle -

  browser.tabs.onRemoved.addListener(async tabId => {
    const tracked = tabTracker[tabId];
    if (!tracked) {
      return;
    }

    delete tabTracker[tabId];
    clearCapturedSabrData(tabId);
    for (const videoId of tracked.videoIdsAvailable) {
      untrackVideoForTab(videoId, tabId);
    }
    await cancelDownloads(tracked.videoIdsAvailable);
  });

  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== "loading" || !tab.url?.includes("youtube.com")) {
      return;
    }

    const tracked = tabTracker[tabId];
    if (!tracked) {
      return;
    }

    for (const videoId of tracked.videoIdsAvailable) {
      untrackVideoForTab(videoId, tabId);
    }
    clearCapturedSabrData(tabId);
    await cancelDownloads(tracked.videoIdsAvailable);

    tabTracker[tabId] = { videoIdsAvailable: [] };
  });

  // - Initialization -

  browser.runtime.onInstalled.addListener(async () => {
    await clearLocalStorage();
  });
});

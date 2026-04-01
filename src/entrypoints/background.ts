import { onMessage, sendMessage } from "../lib/messaging";
import {
  clearCapturedSabrData,
  extractPoTokenFromBody,
  getCapturedSabrData,
  onSabrBodyCaptured,
  startSabrRequestCapture
} from "../lib/sabr-request-capture";
import { clearLocalStorage, interruptedDownloadsItem, isFFmpegReadyItem, statusProgressItem } from "../lib/storage";

export default defineBackground(() => {
  startSabrRequestCapture();
  onSabrBodyCaptured(tabId => {
    // Content script might not be ready yet during initial page load.
    // Send notification and silently ignore connection errors.
    sendMessage("sabrBodyReady", {}, tabId).catch(() => {});
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

  // - Offscreen document management + chunk forwarding (Chrome only) -

  if (import.meta.env.CHROME) {
    let offscreenDocumentPromise: Promise<void> | null = null;

    function ensureOffscreenDocument() {
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

    void ensureOffscreenDocument();

    // Receive chunk from content script, forward to offscreen for accumulation.
    // 1 MB per message stays well under the runtime.sendMessage size limit.
    onMessage("streamChunk", async ({ data, sender }) => {
      const tabId = sender.tab?.id;
      if (!tabId) {
        console.warn("[ytdl:bg] streamChunk: no tabId");
        return;
      }

      await ensureOffscreenDocument();
      await sendMessage("processStreamChunk", { ...data, tabId });
    });

    // Receive stream-end signal, track tab, forward to offscreen for FFmpeg muxing.
    onMessage("streamEnd", async ({ data, sender }) => {
      const tabId = sender.tab?.id;
      if (!tabId) {
        return;
      }

      trackVideoForTab(data.videoId, tabId);

      if (!tabTracker[tabId]) {
        tabTracker[tabId] = { videoIdsAvailable: [data.videoId] };
      } else if (!tabTracker[tabId].videoIdsAvailable.includes(data.videoId)) {
        tabTracker[tabId].videoIdsAvailable.push(data.videoId);
      }

      await ensureOffscreenDocument();
      await sendMessage("processStreamEnd", { ...data, tabId });
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

    void initFirefoxPipeline();

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

    onMessage("streamChunk", ({ data, sender }) => {
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

    onMessage("streamEnd", async ({ data, sender }) => {
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
    if (import.meta.env.CHROME) {
      await sendMessage("cancelProcessing", { videoIds });
    } else {
      const { cancelDownloadsByIds } = await import("../lib/download-pipeline");
      await cancelDownloadsByIds(videoIds);
    }
  }

  // - Message handlers -

  onMessage("getCapturedSabrBody", async ({ sender }) => {
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

  onMessage("persistInterruptedDownload", async ({ data }) => {
    const current = await interruptedDownloadsItem.getValue();
    current[data.videoId] = data;
    await interruptedDownloadsItem.setValue(current);
  });

  onMessage("clearInterruptedDownload", async ({ data }) => {
    const current = await interruptedDownloadsItem.getValue();
    delete current[data.videoId];
    await interruptedDownloadsItem.setValue(current);
  });

  onMessage("getInterruptedDownload", async ({ data }) => {
    const current = await interruptedDownloadsItem.getValue();
    return current[data.videoId] ?? null;
  });

  onMessage("processStreamError", async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return;
    }

    console.error("[ytdl] Stream error for", data.videoId, data.error);
    await sendMessage(
      "updateDownloadProgress",
      {
        videoId: data.videoId,
        progress: 0,
        progressType: "video",
        isRemoved: true
      },
      tabId
    );
  });

  onMessage("requestPlaylistDownload", async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return;
    }

    for (const item of data.items) {
      await sendMessage("executeDownloadItem", item, tabId);
    }
  });

  onMessage("cancelDownload", async ({ data }) => {
    await cancelDownloads(data.videoIds);
  });

  // - Pipeline storage handlers (chrome.storage unavailable in offscreen) -

  onMessage("pipelineProgress", async ({ data }) => {
    const {
      videoId, progress, progressType, tabId
    } = data;
    const current = await statusProgressItem.getValue();
    current[videoId] = { progress, progressType };
    await Promise.allSettled([
      sendMessage("updateDownloadProgress", { videoId, progress, progressType }, tabId),
      statusProgressItem.setValue(current)
    ]);
  });

  onMessage("pipelineRemoval", async ({ data }) => {
    const { videoId, tabId } = data;
    const current = await statusProgressItem.getValue();
    delete current[videoId];
    await Promise.allSettled([
      sendMessage(
        "updateDownloadProgress",
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

  onMessage("pipelineQueueRemove", async ({ data }) => {
    const { videoId } = data;
    const current = await statusProgressItem.getValue();
    delete current[videoId];
    await statusProgressItem.setValue(current);
  });

  onMessage("pipelineFFmpegReady", async () => {
    await isFFmpegReadyItem.setValue(true);
  });

  onMessage("pipelineDownload", async ({ data }) => {
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
    tracked.videoIdsAvailable.forEach(videoId => untrackVideoForTab(videoId, tabId));
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

    tracked.videoIdsAvailable.forEach(videoId => untrackVideoForTab(videoId, tabId));
    clearCapturedSabrData(tabId);
    await cancelDownloads(tracked.videoIdsAvailable);

    tabTracker[tabId] = { videoIdsAvailable: [] };
  });

  // - Initialization -

  browser.runtime.onInstalled.addListener(async () => {
    await clearLocalStorage();
  });
});

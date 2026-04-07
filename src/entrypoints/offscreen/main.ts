/**
 * FFmpeg processor page.
 *
 * Chrome: runs as an offscreen document (persistent, not killed by SW lifecycle).
 * Firefox: opened as a background tab (no offscreen API available).
 *
 * Both provide a full DOM context with Worker + WASM support, so FFmpeg
 * processing completes without crashing the background script.
 */

import { cancelDownloadsByIds, enqueueStreamData, initFFmpeg } from "@/lib/download-pipeline.ts";
import { MessageType, onMessage } from "@/lib/messaging.ts";

// Start loading FFmpeg immediately
initFFmpeg({
  coreURL: browser.runtime.getURL("/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js"),
  wasmURL: browser.runtime.getURL("/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm"),
  classWorkerURL: browser.runtime.getURL("/node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js")
});

// ─── Chunk accumulation ────────────────────────────────────────────────────────
// Large video+audio data is split into 1 MB chunks by the content script to
// stay under Chrome's runtime.sendMessage size limit. Reassemble here before
// handing off to FFmpeg.

interface AudioStreamAccumulator {
  chunks: Map<number, Uint8Array>;
  totalChunks: number;
}

interface StreamAccumulator {
  videoChunks: Map<number, Uint8Array>;
  totalVideoChunks: number;
  // Key: "audio", "audio-extra-0", "audio-extra-1", ...
  audioStreams: Map<string, AudioStreamAccumulator>;
}

const streamAccumulators = new Map<string, StreamAccumulator>();

function assembleStreamChunks(chunks: Map<number, Uint8Array>, totalChunks: number) {
  if (totalChunks === 0) {
    return null;
  }

  const totalBytes = chunks.values()
    .reduce((sum, chunk) => {
      return sum + chunk.byteLength;
    }, 0);
  const result = new Uint8Array(totalBytes);
  let offset = 0;

  for (let i = 0; i < totalChunks; i++) {
    const chunk = chunks.get(i);
    if (!chunk) {
      continue;
    }

    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}

function base64ToUint8Array(base64: string) {
  const binaryString = atob(base64);
  return Uint8Array.from(binaryString, char => {
    return char.charCodeAt(0);
  });
}

onMessage(MessageType.ProcessStreamChunk, ({ data }) => {
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

  // iChunk === -1 is a final marker that sets the correct totalChunks
  // (used by streaming SabrDownload where total is unknown during transfer)
  if (iChunk === -1) {
    if (streamType === "video") {
      accumulator.totalVideoChunks = totalChunks;
    } else {
      const audioStream = accumulator.audioStreams.get(streamType);
      if (audioStream) {
        audioStream.totalChunks = totalChunks;
      }
    }
    return;
  }

  const decodedChunk = base64ToUint8Array(chunkBase64);
  if (streamType === "video") {
    accumulator.videoChunks.set(iChunk, decodedChunk);
    if (totalChunks > 0) {
      accumulator.totalVideoChunks = totalChunks;
    }
  } else {
    if (!accumulator.audioStreams.has(streamType)) {
      accumulator.audioStreams.set(streamType, {
        chunks: new Map(),
        totalChunks: 0
      });
    }

    const audioStream = accumulator.audioStreams.get(streamType)!;
    audioStream.chunks.set(iChunk, decodedChunk);
    if (totalChunks > 0) {
      audioStream.totalChunks = totalChunks;
    }
  }
});

onMessage(MessageType.ProcessStreamEnd, ({ data }) => {
  console.log(`[ytdl:offscreen] streamEnd for ${data.videoId}, type=${data.type}, accumulators:`, [...streamAccumulators.keys()]);
  const {
    videoId, type, filenameOutput, videoMimeType, audioMimeType, audioTrackLabels, tabId,
    playlistId, playlistTitle, playlistTotalCount
  } = data;
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
    playlistTotalCount,
    metadata: data.metadata
  });
});

onMessage(MessageType.CancelProcessing, async ({ data }) => {
  await cancelDownloadsByIds(data.videoIds);
});

// Proxy fetch through the offscreen document context via Port connection.
// The background SW connects via chrome.runtime.connect and sends fetch
// requests. declarativeNetRequest injects Cookie/Origin headers for
// background_page requests (but not service_worker), so DNR applies here.
browser.runtime.onConnect.addListener(port => {
  if (port.name !== "ytdl-proxy-fetch") {
    return;
  }

  port.onMessage.addListener(async (message: { requestId: string; url: string; bodyBase64: string }) => {
    const { requestId, url, bodyBase64 } = message;
    console.log("[ytdl:offscreen] Port request received:", url.substring(0, 60));

    try {
      const bodyBytes = Uint8Array.from(atob(bodyBase64), character => {
        return character.charCodeAt(0);
      });

      // Use XMLHttpRequest instead of fetch. Chrome sets Origin: chrome-extension://
      // on fetch() which googlevideo rejects with 403. XHR in extension pages with
      // host_permissions doesn't send the extension Origin.
      const response = await new Promise<Response>((resolveXhr, rejectXhr) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);
        xhr.setRequestHeader("Content-Type", "application/x-protobuf");
        xhr.responseType = "arraybuffer";
        xhr.onload = () => {
          resolveXhr(new Response(xhr.response, {
            status: xhr.status,
            statusText: xhr.statusText,
            headers: { "content-type": xhr.getResponseHeader("content-type") ?? "application/octet-stream" }
          }));
        };
        xhr.onerror = () => rejectXhr(new TypeError("Network error"));
        xhr.timeout = 60000;
        xhr.ontimeout = () => rejectXhr(new TypeError("Timeout"));
        xhr.send(bodyBytes);
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

      console.log("[ytdl:offscreen] Port response:", response.status, "size:", responseBytes.byteLength);
      port.postMessage({
        requestId,
        result: { status: response.status, bodyBase64: btoa(responseBase64) }
      });
    } catch (error) {
      console.error("[ytdl:offscreen] proxyFetch error:", error);
      port.postMessage({ requestId, result: null });
    }
  });
});

/**
 * Offscreen document - Chrome MV3 only.
 *
 * Runs in a persistent context (not a service worker), so FFmpeg WASM
 * processing completes without being killed by the browser.
 */

import { cancelDownloadsByIds, enqueueStreamData, initFFmpeg } from "@/lib/download-pipeline.ts";
import { onMessage } from "@/lib/messaging.ts";

// Start loading FFmpeg immediately
initFFmpeg(
  browser.runtime.getURL("/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js"),
  browser.runtime.getURL("/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm"),
  browser.runtime.getURL("/node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js")
);

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
    .reduce((sum, chunk) => sum + chunk.byteLength, 0);
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
  return Uint8Array.from(binaryString, char => char.charCodeAt(0));
}

onMessage("processStreamChunk", ({ data }) => {
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
  const decodedChunk = base64ToUint8Array(chunkBase64);
  if (streamType === "video") {
    accumulator.videoChunks.set(iChunk, decodedChunk);
    accumulator.totalVideoChunks = totalChunks;
  } else {
    if (!accumulator.audioStreams.has(streamType)) {
      accumulator.audioStreams.set(streamType, { chunks: new Map(), totalChunks: 0 });
    }

    const audioStream = accumulator.audioStreams.get(streamType)!;
    audioStream.chunks.set(iChunk, decodedChunk);
    audioStream.totalChunks = totalChunks;
  }
});

onMessage("processStreamEnd", ({ data }) => {
  console.log(`[ytdl:offscreen] streamEnd for ${data.videoId}, type=${data.type}, accumulators:`, [...streamAccumulators.keys()]);
  const {
    videoId, type, filenameOutput, videoMimeType, audioMimeType, audioTrackLabels, tabId
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
    tabId
  });
});

onMessage("cancelProcessing", async ({ data }) => {
  await cancelDownloadsByIds(data.videoIds);
});

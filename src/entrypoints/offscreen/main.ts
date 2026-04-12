/**
 * FFmpeg processor page.
 *
 * Chrome: runs as an offscreen document (persistent, not killed by SW lifecycle).
 * Firefox: opened as a background tab (no offscreen API available).
 *
 * Both provide a full DOM context with Worker + WASM support, so FFmpeg
 * processing completes without crashing the background script.
 */

import { cancelDownloadsByIds, enqueueStreamData, initFFmpeg } from "@/lib/download-pipeline";
import { transcodeRecentDownload } from "@/lib/download-pipeline/transcode-recent";
import { OffscreenMessageType, listenForOffscreenMessages } from "@/lib/offscreen-messaging";
import { DownloadType, StreamType } from "@/types";
import type { VideoMetadata } from "@/types";
import type { FFmpegCoreModuleFactory } from "@ffmpeg/types";

// Loaded via <script> tag in index.html — the UMD build sets this global and
// resolves ffmpeg-core.wasm relative to document.currentScript.src automatically.
declare const createFFmpegCore: FFmpegCoreModuleFactory;

const core = await createFFmpegCore({});
initFFmpeg(core);

// ─── Chunk accumulation ────────────────────────────────────────────────────────
// The content script splits large video+audio data into 1 MB chunks to
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

listenForOffscreenMessages({
  [OffscreenMessageType.ProcessStreamChunk]: handleProcessStreamChunk,
  [OffscreenMessageType.ProcessStreamEnd]: handleProcessStreamEnd,
  [OffscreenMessageType.CancelProcessing](data) {
    void cancelDownloadsByIds(data.videoIds);
  },
  [OffscreenMessageType.TranscodeRecentDownload](data) {
    void transcodeRecentDownload(data);
  }
});

function handleProcessStreamChunk(data: {
  videoId: string;
  streamType: string;
  iChunk: number;
  totalChunks: number;
  chunkBase64: string;
  tabId: number;
}) {
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

  // iChunk === -1 is a final marker that sets the correct totalChunks
  // (used by streaming SabrDownload where total is unknown during transfer)
  const accumulator = streamAccumulators.get(videoId)!;
  if (iChunk === -1) {
    if (streamType === StreamType.Video) {
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
  if (streamType === StreamType.Video) {
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
}

function handleProcessStreamEnd(data: {
  videoId: string;
  type: DownloadType;
  filenameOutput: string;
  videoMimeType: string;
  audioMimeType: string;
  audioTrackLabels: string[];
  tabId: number;
  playlistId?: string;
  playlistTitle?: string;
  playlistTotalCount?: number;
  metadata?: VideoMetadata | null;
}) {
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
}

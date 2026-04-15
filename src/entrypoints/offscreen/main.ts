import { cancelDownloadsByIds, enqueueStreamData, initFFmpeg } from "@/lib/download-pipeline";
import { transcodeRecentDownload } from "@/lib/download-pipeline/transcode-recent";
import { OffscreenMessageType, listenForOffscreenMessages } from "@/lib/messaging/offscreen-messaging";
import { DownloadType, StreamType } from "@/types";
import type { VideoMetadata } from "@/types";
import type { FFmpegCoreModuleFactory } from "@ffmpeg/types";

// Loaded via <script> tag in index.html; the UMD build sets this global
// and resolves ffmpeg-core.wasm relative to document.currentScript.src.
declare const createFFmpegCore: FFmpegCoreModuleFactory;

const core = await createFFmpegCore({});
initFFmpeg(core);

// Content script splits video+audio into 1 MB chunks to stay under runtime.sendMessage size limit.
const streamAccumulators = new Map<string, {
  videoChunks: Map<number, Uint8Array>;
  totalVideoChunks: number;
  audioStreams: Map<string, {
    chunks: Map<number, Uint8Array>;
    totalChunks: number;
  }>;
}>();

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

  // iChunk === -1 is a final marker that sets totalChunks for streaming SabrDownload
  // where total is unknown during transfer.
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

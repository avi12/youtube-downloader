import { STREAM_ACCUMULATORS } from "./accumulator";
import { assembleStreamChunks } from "./codec";
import { enqueueStreamData } from "@/lib/download-pipeline";
import { DownloadType } from "@/types";
import type { SubtitleStream, VideoMetadata } from "@/types";

type StreamEndData = {
  videoId: string;
  type: DownloadType;
  filenameOutput: string;
  videoMimeType: string;
  audioMimeType: string;
  audioTrackLabels: string[];
  subtitleStreams?: SubtitleStream[];
  tabId: number;
  playlistId?: string;
  playlistTitle?: string;
  playlistTotalCount?: number;
  metadata?: VideoMetadata | null;
};

function assembleAdditionalAudioStreams({
  accumulator,
  audioTrackLabels,
  audioMimeType
}: {
  accumulator: ReturnType<typeof STREAM_ACCUMULATORS.get>;
  audioTrackLabels: string[];
  audioMimeType: string;
}) {
  return audioTrackLabels.slice(1).map((label, iTrack) => {
    const audioStream = accumulator?.audioStreams.get(`audio-extra-${iTrack}`);
    return {
      data: audioStream
        ? assembleStreamChunks({
          chunks: audioStream.chunks,
          totalChunks: audioStream.totalChunks
        })
        : null,
      mimeType: audioMimeType,
      label
    };
  });
}

export function handleProcessStreamEnd(data: StreamEndData) {
  const {
    videoId, type, filenameOutput, videoMimeType, audioMimeType, audioTrackLabels,
    subtitleStreams = [], tabId, playlistId, playlistTitle, playlistTotalCount
  } = data;

  const accumulator = STREAM_ACCUMULATORS.get(videoId);
  STREAM_ACCUMULATORS.delete(videoId);

  const additionalAudioStreams = assembleAdditionalAudioStreams({
    accumulator,
    audioTrackLabels,
    audioMimeType
  });

  const primaryAudio = accumulator?.audioStreams.get("audio");
  const primaryAudioLabel = audioTrackLabels[0];

  enqueueStreamData({
    type,
    videoId,
    filenameOutput,
    videoData: accumulator
      ? assembleStreamChunks({
        chunks: accumulator.videoChunks,
        totalChunks: accumulator.totalVideoChunks
      })
      : null,
    audioData: primaryAudio
      ? assembleStreamChunks({
        chunks: primaryAudio.chunks,
        totalChunks: primaryAudio.totalChunks
      })
      : null,
    videoMimeType,
    audioMimeType,
    primaryAudioLabel,
    additionalAudioStreams,
    subtitleStreams,
    tabId,
    playlistId,
    playlistTitle,
    playlistTotalCount,
    metadata: data.metadata
  });
}

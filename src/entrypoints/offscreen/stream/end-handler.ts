import { STREAM_ACCUMULATORS } from "./accumulator";
import { assembleStreamChunks } from "./codec";
import { enqueueStreamData } from "@/lib/download-pipeline";
import { DownloadType } from "@/types";
import type { VideoMetadata } from "@/types";

export function handleProcessStreamEnd(data: {
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
  const accumulator = STREAM_ACCUMULATORS.get(videoId);
  STREAM_ACCUMULATORS.delete(videoId);

  const primaryAudio = accumulator?.audioStreams.get("audio");
  const extraTrackLabels = audioTrackLabels.slice(1);
  const additionalAudioStreams = extraTrackLabels.map((label, iTrack) => {
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
    primaryAudioLabel: audioTrackLabels[0],
    additionalAudioStreams,
    tabId,
    playlistId,
    playlistTitle,
    playlistTotalCount,
    metadata: data.metadata
  });
}

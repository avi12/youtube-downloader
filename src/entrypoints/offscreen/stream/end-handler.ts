import { STREAM_ACCUMULATORS } from "./accumulator";
import { assembleStreamChunks } from "./codec";
import { enqueueStreamData } from "@/lib/download-pipeline";
import { DownloadType } from "@/types";
import type { ScrubSegment, SubtitleStream, VideoMetadata } from "@/types";

export function handleProcessStreamEnd(data: {
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
  segmentCount?: number;
  segmentDurationSec?: number;
  segmentVideoBufferStartSecs?: (number | undefined)[];
}) {
  const {
    videoId, type, filenameOutput, videoMimeType, audioMimeType, audioTrackLabels,
    subtitleStreams = [], tabId, playlistId, playlistTitle, playlistTotalCount,
    segmentCount, segmentDurationSec, segmentVideoBufferStartSecs
  } = data;
  const accumulator = STREAM_ACCUMULATORS.get(videoId);
  STREAM_ACCUMULATORS.delete(videoId);

  let segments: ScrubSegment[] | undefined;
  if (segmentCount && accumulator?.segments.size) {
    const ordered: ScrubSegment[] = [];
    for (let i = 0; i < segmentCount; i++) {
      const segmentData = accumulator.segments.get(i);
      if (!segmentData) {
        continue;
      }

      const video = assembleStreamChunks({
        chunks: segmentData.videoChunks,
        totalChunks: segmentData.totalVideoChunks
      });
      const audio = assembleStreamChunks({
        chunks: segmentData.audioChunks,
        totalChunks: segmentData.totalAudioChunks
      });
      if (video && audio) {
        ordered.push({
          video,
          audio,
          videoBufferStartSec: segmentVideoBufferStartSecs?.[i]
        });
      }
    }

    if (ordered.length > 0) {
      segments = ordered;
    }
  }

  const primaryAudio = accumulator?.audioStreams.get("audio");
  const [primaryAudioLabel, ...extraTrackLabels] = audioTrackLabels;
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
    primaryAudioLabel,
    additionalAudioStreams,
    subtitleStreams,
    segments,
    segmentDurationSec,
    tabId,
    playlistId,
    playlistTitle,
    playlistTotalCount,
    metadata: data.metadata
  });
}

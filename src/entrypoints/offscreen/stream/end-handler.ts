import { STREAM_ACCUMULATORS } from "./accumulator";
import { assembleStreamChunks } from "./codec";
import { enqueueStreamData } from "@/lib/download-pipeline";
import { base64ToUint8Array } from "@/lib/utils/binary";
import { AUDIO_EXTRA_STREAM_PREFIX, DownloadType } from "@/types";
import type { VideoMetadata } from "@/types";

export function handleProcessStreamEnd(data: {
  videoId: string;
  type: DownloadType;
  filenameOutput: string;
  videoMimeType: string;
  audioMimeType: string;
  audioTrackLabels: string[];
  audioTrackLanguages?: string[];
  defaultAudioTrackIndex?: number;
  subtitleTracks?: {
    dataBase64: string;
    label: string;
    languageCode: string;
  }[];
  tabId: number;
  playlistId?: string;
  playlistTitle?: string;
  playlistTotalCount?: number;
  metadata?: VideoMetadata | null;
}) {
  const {
    videoId, type, filenameOutput, videoMimeType, audioMimeType,
    audioTrackLabels, audioTrackLanguages, defaultAudioTrackIndex, subtitleTracks, tabId,
    playlistId, playlistTitle, playlistTotalCount
  } = data;
  const accumulator = STREAM_ACCUMULATORS.get(videoId);
  STREAM_ACCUMULATORS.delete(videoId);

  const primaryAudio = accumulator?.audioStreams.get("audio");
  const [primaryAudioLabel, ...extraTrackLabels] = audioTrackLabels;
  const [primaryAudioLanguageCode, ...extraTrackLanguages] = audioTrackLanguages ?? [];
  const additionalAudioStreams = extraTrackLabels.map((label, iTrack) => {
    const audioStream = accumulator?.audioStreams.get(`${AUDIO_EXTRA_STREAM_PREFIX}-${iTrack}`);
    return {
      data: audioStream
        ? assembleStreamChunks({
          chunks: audioStream.chunks,
          totalChunks: audioStream.totalChunks
        })
        : null,
      mimeType: audioMimeType,
      label,
      languageCode: extraTrackLanguages[iTrack] ?? ""
    };
  });

  const decodedSubtitleTracks = (subtitleTracks ?? []).map(({ dataBase64, label, languageCode }) => ({
    data: base64ToUint8Array(dataBase64),
    label,
    languageCode
  }));

  enqueueStreamData({
    type,
    videoId,
    filenameOutput,
    primaryAudioLanguageCode,
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
    subtitleTracks: decodedSubtitleTracks,
    defaultAudioTrackIndex,
    tabId,
    playlistId,
    playlistTitle,
    playlistTotalCount,
    metadata: data.metadata
  });
}

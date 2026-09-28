import { STREAM_ACCUMULATORS } from "./accumulator";
import { assembleStreamChunks } from "./codec";
import { enqueueStreamData, reportProgress } from "@/lib/download-pipeline";
import type { ProcessStreamEndData } from "@/lib/messaging/offscreen-messaging";
import { base64ToUint8Array } from "@/lib/utils/binary";
import { AUDIO_EXTRA_STREAM_PREFIX, ProgressType } from "@/types";

export async function handleProcessStreamEnd(data: ProcessStreamEndData) {
  const {
    videoId, type, filenameOutput, videoMimeType, audioMimeType,
    audioTrackLabels, audioTrackLanguages, defaultAudioTrackIndex, subtitleTracks, tabId,
    playlistId, playlistTitle, playlistTotalCount, quality, sourceUrl
  } = data;

  // Download bytes are in; mark the mux phase now so the UI shows "Processing"
  // through the (potentially slow, multi-GB) assembly before ffmpeg starts.
  await reportProgress({
    videoId,
    progress: 0,
    progressType: ProgressType.FFmpeg,
    tabId
  }).catch(() => {});

  const accumulator = STREAM_ACCUMULATORS.get(videoId);
  STREAM_ACCUMULATORS.delete(videoId);

  const videoFileHandle = accumulator?.videoWriter
    ? await accumulator.videoWriter.close()
    : null;
  const videoFile = videoFileHandle ? await videoFileHandle.getFile() : null;

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
    videoData: null,
    videoFile: videoFile ?? undefined,
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
    metadata: data.metadata,
    quality,
    sourceUrl
  });
}

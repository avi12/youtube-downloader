import { ensureProcessor } from "../handlers/processor";
import type { DownloadResult } from "./download-result-types";
import { buildSubtitleTracks, buildTransferJobs } from "./stream-chunk-transfer";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { stripMimeParams } from "@/lib/utils/containers";
import { ProgressType } from "@/types";
import type { DownloadRequest, VideoMetadata } from "@/types";

const FALLBACK_VIDEO_MIME_TYPE = "video/mp4";
const FALLBACK_AUDIO_MIME_TYPE = "audio/mp4";

type DispatchToOffscreenParams = {
  request: DownloadRequest;
  result: DownloadResult;
  enrichedMetadata: VideoMetadata | null | undefined;
  tabId: number;
  skipChunkTransfer?: boolean;
};
export async function dispatchToOffscreen(
  { request, result, enrichedMetadata, tabId, skipChunkTransfer }: DispatchToOffscreenParams
) {
  void sendMessage(MessageType.UpdateDownloadProgress, {
    videoId: request.videoId,
    progress: 0,
    progressType: ProgressType.FFmpeg
  }, tabId);
  await ensureProcessor();

  const {
    videoId, type, filenameOutput, videoFormat, audioFormat,
    primaryAudioLabel, captionTracks, playlistId, playlistTitle, playlistTotalCount
  } = request;
  const { videoData, audioData, additionalAudioTracks } = result;

  const resolvedVideoMimeType = videoFormat ? stripMimeParams(videoFormat.mimeType) : FALLBACK_VIDEO_MIME_TYPE;
  const resolvedAudioMimeType = audioFormat ? stripMimeParams(audioFormat.mimeType) : FALLBACK_AUDIO_MIME_TYPE;
  if (!skipChunkTransfer) {
    await Promise.all(
      buildTransferJobs({
        videoData,
        audioData,
        additionalAudioTracks,
        videoId,
        tabId
      })
    );
  } else {
    const hasExtraTrackData = additionalAudioTracks.some(track => track.data);
    if (hasExtraTrackData) {
      await Promise.all(
        buildTransferJobs({
          videoData: null,
          audioData: null,
          additionalAudioTracks,
          videoId,
          tabId
        })
      );
    }
  }

  const audioTrackLabels = [primaryAudioLabel ?? "", ...additionalAudioTracks.map(track => track.label)];
  const audioTrackLanguages = [
    request.primaryAudioLanguageCode ?? "",
    ...additionalAudioTracks.map(track => track.languageCode)
  ];

  const subtitleTracks = buildSubtitleTracks({
    captionTracks,
    captionVttData: request.captionVttData ?? []
  });

  sendToOffscreen({
    type: OffscreenMessageType.ProcessStreamEnd,
    data: {
      type,
      videoId,
      filenameOutput,
      videoMimeType: resolvedVideoMimeType,
      audioMimeType: resolvedAudioMimeType,
      audioTrackLabels,
      audioTrackLanguages,
      defaultAudioTrackIndex: 0,
      subtitleTracks,
      tabId,
      playlistId,
      playlistTitle,
      playlistTotalCount,
      metadata: enrichedMetadata
    }
  });
}

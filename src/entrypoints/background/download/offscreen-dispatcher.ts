import { ensureProcessor } from "../handlers/processor";
import type { DownloadResult } from "./background-downloader";
import { fetchSubtitleStreams } from "./subtitle-fetcher";
import { OffscreenMessageType, sendBytesToOffscreen, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { fetchYouTubeMusicMetadata } from "@/lib/youtube/youtube-music-metadata";
import { StreamType } from "@/types";
import type { DownloadRequest, VideoMetadata } from "@/types";

export async function enrichMetadataFromYouTubeMusic(metadata: VideoMetadata | null | undefined) {
  if (!metadata?.isMusic) {
    return metadata;
  }

  const searchQuery = `${metadata.artist} ${metadata.title}`.trim();
  if (!searchQuery) {
    return metadata;
  }

  return fetchYouTubeMusicMetadata({
    searchQuery,
    existingMetadata: metadata
  });
}

export async function dispatchToOffscreen({ request, result, enrichedMetadata, tabId }: {
  request: DownloadRequest;
  result: DownloadResult;
  enrichedMetadata: VideoMetadata | null | undefined;
  tabId: number;
}) {
  await ensureProcessor();

  const resolvedVideoMimeType = request.videoFormat?.mimeType.split(";")[0] ?? "video/mp4";
  const resolvedAudioMimeType = request.audioFormat?.mimeType.split(";")[0] ?? "audio/mp4";
  const transferJobs: Promise<void>[] = [];
  if (result.videoData) {
    transferJobs.push(
      sendBytesToOffscreen({
        videoId: request.videoId,
        streamType: StreamType.Video,
        data: result.videoData,
        tabId
      })
    );
  }

  if (result.audioData) {
    transferJobs.push(
      sendBytesToOffscreen({
        videoId: request.videoId,
        streamType: StreamType.Audio,
        data: result.audioData,
        tabId
      })
    );
  }

  for (const [i, track] of result.additionalAudioTracks.entries()) {
    if (track.data) {
      transferJobs.push(
        sendBytesToOffscreen({
          videoId: request.videoId,
          streamType: `audio-extra-${i}`,
          data: track.data,
          tabId
        })
      );
    }
  }

  const [subtitleStreams] = await Promise.all([
    fetchSubtitleStreams(request.captionTracks ?? []),
    Promise.all(transferJobs)
  ]);

  const audioTrackLabels = [
    request.primaryAudioLabel ?? "",
    ...result.additionalAudioTracks.map(track => track.label)
  ];

  sendToOffscreen(OffscreenMessageType.ProcessStreamEnd, {
    type: request.type,
    videoId: request.videoId,
    filenameOutput: request.filenameOutput,
    videoMimeType: resolvedVideoMimeType,
    audioMimeType: resolvedAudioMimeType,
    audioTrackLabels,
    subtitleStreams,
    tabId,
    playlistId: request.playlistId,
    playlistTitle: request.playlistTitle,
    playlistTotalCount: request.playlistTotalCount,
    metadata: enrichedMetadata
  });
}

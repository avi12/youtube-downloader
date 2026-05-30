import { triggerDownload } from ".";
import { runTranscodeFile } from "./ffmpeg-instance";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { getRecentDownloadBlob, getAllRecentDownloads } from "@/lib/storage/recent-downloads-db";
import type { RecentDownloadEntry } from "@/lib/storage/recent-downloads-db";
import { audioContainers, splitFilenameAndExtension, videoContainers } from "@/lib/utils/containers";
import { fetchMusicThumbnailUrl } from "@/lib/youtube/youtube-music-metadata";
import { DownloadType } from "@/types";

export const TRANSCODE_VIDEO_ID_PREFIX = "transcode:";

type TranscodeRecentDownloadParams = {
  entryId: string;
  targetContainer: string;
};

async function resolveCoverArtUrl(entry: RecentDownloadEntry) {
  const searchQuery = `${entry.channel} ${entry.title}`.trim();
  const musicUrl = await fetchMusicThumbnailUrl(searchQuery);
  return musicUrl ?? entry.thumbnailUrl;
}

export async function transcodeRecentDownload({ entryId, targetContainer }: TranscodeRecentDownloadParams) {
  const transcodeVideoId = `${TRANSCODE_VIDEO_ID_PREFIX}${entryId}`;

  try {
    const allEntries = await getAllRecentDownloads();
    const entry = allEntries.find(item => item.id === entryId);
    const isEntryMissing = !entry;
    if (isEntryMissing) {
      console.warn("[ytdl:transcode] Entry not found:", entryId);
      return;
    }

    const blob = await getRecentDownloadBlob(entryId);
    const isBlobMissing = !blob;
    if (isBlobMissing) {
      console.warn("[ytdl:transcode] Blob not found:", entryId);
      return;
    }

    const downloadFilename = `${splitFilenameAndExtension(entry.filename).name}.${targetContainer}`;
    const isVideoToAudio = videoContainers.includes(entry.container) && audioContainers.includes(targetContainer);
    const coverArtUrl = isVideoToAudio ? await resolveCoverArtUrl(entry) : undefined;

    const output = await runTranscodeFile({
      videoId: transcodeVideoId,
      job: {
        videoId: transcodeVideoId,
        tabId: 0,
        data: await blob.arrayBuffer(),
        sourceExtension: entry.container,
        targetContainer,
        audioMimeType: entry.audioMimeType,
        videoMimeType: entry.videoMimeType,
        coverArtUrl
      }
    });
    const isOutputMissing = !output;
    if (isOutputMissing) {
      throw new Error("FFmpeg returned no data for recent download transcode");
    }

    await triggerDownload({
      data: output,
      filenameOutput: downloadFilename,
      recentContext: {
        videoId: entry.videoId,
        title: entry.title,
        channel: entry.channel,
        thumbnailUrl: entry.thumbnailUrl
      }
    });
  } finally {
    void sendMessage(MessageType.PipelineQueueRemove, {
      videoId: transcodeVideoId,
      type: DownloadType.VideoAndAudio
    });
  }
}

import { triggerDownload } from ".";
import { runTranscodeFile } from "./ffmpeg-instance";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { getRecentDownloadBlob, getAllRecentDownloads } from "@/lib/storage/recent-downloads-db";
import { splitFilenameAndExtension } from "@/lib/utils/containers";
import { DownloadType } from "@/types";

export const TRANSCODE_VIDEO_ID_PREFIX = "transcode:";

type TranscodeRecentDownloadParams = {
  entryId: string;
  targetContainer: string;
};
export async function transcodeRecentDownload({ entryId, targetContainer }: TranscodeRecentDownloadParams) {
  const transcodeVideoId = `${TRANSCODE_VIDEO_ID_PREFIX}${entryId}`;

  try {
    const allEntries = await getAllRecentDownloads();
    const entry = allEntries.find(item => item.id === entryId);
    if (!entry) {
      console.warn("[ytdl:transcode] Entry not found:", entryId);
      return;
    }

    const blob = await getRecentDownloadBlob(entryId);
    if (!blob) {
      console.warn("[ytdl:transcode] Blob not found:", entryId);
      return;
    }

    const downloadFilename = `${splitFilenameAndExtension(entry.filename).name}.${targetContainer}`;

    const output = await runTranscodeFile({
      videoId: transcodeVideoId,
      job: {
        videoId: transcodeVideoId,
        tabId: 0,
        data: await blob.arrayBuffer(),
        sourceExtension: entry.container,
        targetContainer,
        audioMimeType: entry.audioMimeType
      }
    });
    if (!output) {
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

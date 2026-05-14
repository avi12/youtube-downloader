import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import type { PipelineDownloadMessage } from "@/lib/messaging/messaging";
import { addRecentDownload } from "@/lib/storage/recent-downloads-db";
import { getFileExtension } from "@/lib/utils/containers";

export async function persistRecentDownload({ downloadId, data }: {
  downloadId: number;
  data: PipelineDownloadMessage;
}) {
  const context = data.recentContext;
  if (!context) {
    return;
  }

  try {
    const response = await fetch(data.blobUrl);
    const blob = await response.blob();
    await addRecentDownload({
      entry: {
        id: crypto.randomUUID(),
        downloadId,
        videoId: context.videoId,
        title: context.title,
        channel: context.channel,
        filename: data.filename,
        container: getFileExtension(data.filename),
        mimeType: data.mimeType,
        videoMimeType: context.videoMimeType,
        audioMimeType: context.audioMimeType,
        size: blob.size,
        thumbnailUrl: context.thumbnailUrl,
        completedAt: Date.now()
      },
      blob
    });
    try {
      await sendMessage(MessageType.RecentDownloadsChanged);
    } catch {
      // Popup not open - ignore.
    }
  } catch (error) {
    console.warn("[ytdl:bg] Persist recent download failed:", error);
  }
}

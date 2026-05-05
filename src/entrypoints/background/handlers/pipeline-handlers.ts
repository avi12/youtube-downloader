import { removeHostedIframe } from "../iframe-host/iframe-host";
import { markVideosCancelled, registerPipelineProgressHandlers } from "./pipeline-progress";
import { signalFFmpegReady } from "./processor";
import { broadcastDebugLogToYouTubeTabs } from "@/lib/messaging/debug-log";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { addRecentDownload, takePendingBlob } from "@/lib/storage/recent-downloads-db";
import { isFFmpegReadyItem } from "@/lib/storage/storage";
import { ProgressType } from "@/types";

const DOWNLOAD_RETRY_INTERVAL_MS = 3_000;
const DOWNLOAD_MAX_RETRIES = 20;

type RecentContext = NonNullable<Parameters<Parameters<typeof onMessage<"pipelineTriggerDownload">>[1]>[0]["data"]["recentContext"]>;

function waitForDownload(downloadId: number) {
  return new Promise<boolean>(resolve => {
    function handleChanged(delta: Browser.downloads.DownloadDelta) {
      if (delta.id !== downloadId || !delta.state?.current) {
        return;
      }

      browser.downloads.onChanged.removeListener(handleChanged);
      resolve(delta.state.current === browser.downloads.State.COMPLETE);
    }
    browser.downloads.onChanged.addListener(handleChanged);
  });
}

function extractContainer(filename: string) {
  const iDot = filename.lastIndexOf(".");
  return iDot === -1 ? "" : filename.slice(iDot + 1).toLowerCase();
}

async function persistRecentDownload({ downloadId, pendingBlobKey, mimeType, filename, recentContext }: {
  downloadId: number;
  pendingBlobKey: string;
  mimeType: string;
  filename: string;
  recentContext: RecentContext;
}) {
  const isComplete = await waitForDownload(downloadId);
  if (!isComplete) {
    return;
  }

  try {
    const blob = await takePendingBlob(pendingBlobKey);
    if (!blob) {
      return;
    }

    await addRecentDownload({
      entry: {
        id: crypto.randomUUID(),
        downloadId,
        videoId: recentContext.videoId,
        title: recentContext.title,
        channel: recentContext.channel,
        filename,
        container: extractContainer(filename),
        mimeType,
        size: blob.size,
        thumbnailUrl: recentContext.thumbnailUrl,
        completedAt: Date.now()
      },
      blob
    });
    try {
      await sendMessage(MessageType.RecentDownloadsChanged, {});
    } catch {
      // popup not open
    }
  } catch (error) {
    console.warn("[ytdl:bg] Persist recent download failed:", error);
  }
}

export { markVideosCancelled };

export function registerPipelineHandlers() {
  registerPipelineProgressHandlers();

  onMessage(MessageType.ProcessStreamError, ({ data, sender }) => {
    console.error("[ytdl:bg] Stream error for", data.videoId, data.error);
    const tabId = sender.tab?.id;

    void browser.tabs.query({ url: "*://www.youtube.com/*" }).then(tabs => {
      for (const tab of tabs) {
        if (typeof tab.id !== "number") {
          continue;
        }

        void sendMessage(MessageType.BgDebugLog, { msg: `[ytdl:pipeline-error] ${data.videoId}: ${data.error}` }, tab.id);

        if (!tabId) {
          void sendMessage(MessageType.UpdateDownloadProgress, {
            videoId: data.videoId,
            progress: 0,
            progressType: ProgressType.Video,
            isRemoved: true
          }, tab.id);
        }
      }
    });

    if (!tabId) {
      return;
    }

    void sendMessage(MessageType.UpdateDownloadProgress, {
      videoId: data.videoId,
      progress: 0,
      progressType: ProgressType.Video,
      isRemoved: true
    }, tabId);
    removeHostedIframe(`dl-${data.videoId}`);
  });

  onMessage(MessageType.PipelineFFmpegReady, () => {
    void broadcastDebugLogToYouTubeTabs("[ytdl:bg] PipelineFFmpegReady received - signaling processor ready");
    void isFFmpegReadyItem.setValue(true);
    signalFFmpegReady();
  });

  onMessage(MessageType.PipelineZipProgress, ({ data }) => {
    const { playlistId, isDone, tabId } = data;
    void sendMessage(MessageType.UpdateDownloadProgress, {
      videoId: `zip:${playlistId}`,
      progress: isDone ? 1 : 0,
      progressType: ProgressType.Zip
    }, tabId);
  });

  onMessage(MessageType.PipelineTriggerDownload, async ({ data }) => {
    let downloadId: number | undefined;
    for (let i = 0; i < DOWNLOAD_MAX_RETRIES; i++) {
      try {
        downloadId = await browser.downloads.download({
          url: data.blobUrl,
          filename: data.filename
        });
        break;
      } catch (error) {
        console.warn("[ytdl:bg] downloads.download failed attempt", i + 1, String(error), "filename:", data.filename);
        await new Promise(resolve => setTimeout(resolve, DOWNLOAD_RETRY_INTERVAL_MS));
      }
    }

    if (downloadId === undefined) {
      console.error("[ytdl:bg] PipelineTriggerDownload: all retries exhausted for", data.filename);
      return false;
    }

    if (data.recentContext) {
      void persistRecentDownload({
        downloadId,
        pendingBlobKey: data.pendingBlobKey,
        mimeType: data.mimeType,
        filename: data.filename,
        recentContext: data.recentContext
      });
    }

    return true;
  });
}

import { persistOnDownloadComplete } from "./recent-download-persist";
import { MessageType, onMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";

function scheduleRevokeBlobUrl({ downloadId, blobUrl }: {
  downloadId: number;
  blobUrl: string;
}) {
  function handleChanged(delta: Browser.downloads.DownloadDelta) {
    const isUnrelatedOrIncomplete = delta.id !== downloadId || !delta.state?.current;
    if (isUnrelatedOrIncomplete) {
      return;
    }

    const { current } = delta.state!;
    const isTerminal = current === browser.downloads.State.COMPLETE
      || current === browser.downloads.State.INTERRUPTED;
    if (!isTerminal) {
      return;
    }

    browser.downloads.onChanged.removeListener(handleChanged);
    sendToOffscreen({
      type: OffscreenMessageType.RevokeBlobUrl,
      data: {
        blobUrl
      }
    });
  }

  browser.downloads.onChanged.addListener(handleChanged);
}

export function registerRecentDownloadHandlers() {
  onMessage(MessageType.PipelineDownload, async ({ data }) => {
    const downloadId = await browser.downloads.download({
      url: data.blobUrl,
      filename: data.filename
    });
    scheduleRevokeBlobUrl({
      downloadId,
      blobUrl: data.blobUrl
    });

    if (data.recentContext) {
      void persistOnDownloadComplete({
        downloadId,
        data
      });
    }
  });

  onMessage(MessageType.RevealDownloadFile, ({ data }) => {
    browser.downloads.show(data.downloadId);
  });
}

import { cancelBackgroundDownload, startBackgroundDownload } from "../download/background-downloader";
import { removeHostedIframe } from "../iframe-host/iframe-host";
import { enqueueToPopupList, removeFromPopupList } from "../queue/popup-list";
import { signalVideoComplete } from "../queue/sequential-queue";
import { cancelDownloads, getTabIdsForVideo, trackVideoForTab } from "../queue/tab-tracker";
import { cancelIframeScrubSession } from "../scrub/orchestrator";
import {
  dispatchParallel,
  dispatchSequentially,
  downloadIframeId,
  downloadViaWatchPage,
  initIframeReadyListener
} from "./iframe-download";
import { markVideosCancelled } from "./pipeline-handlers";
import { registerProxyFetchHandler } from "./proxy-fetch-handler";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { ProgressType } from "@/types";

let currentSequenceAbort: AbortController | null = null;
let currentSequenceTabId: number | null = null;

export function registerDownloadHandlers() {
  initIframeReadyListener();
  registerProxyFetchHandler();

  onMessage(MessageType.DownloadViaWatchPage, ({ data, sender }) => {
    const originTabId = sender.tab?.id;
    if (!originTabId) {
      return;
    }

    void downloadViaWatchPage({
      data,
      tabId: originTabId
    });
  });

  onMessage(MessageType.Keepalive, () => {});

  onMessage(MessageType.RequestPlaylistDownload, async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return;
    }

    currentSequenceAbort?.abort();
    currentSequenceAbort = null;
    currentSequenceTabId = tabId;

    await enqueueToPopupList(
      data.items.map(item => ({
        videoId: item.videoId,
        type: item.type,
        filenameOutput: item.filenameOutput
      }))
    );

    currentSequenceAbort = new AbortController();

    if (data.isSequential) {
      void dispatchSequentially({
        items: data.items,
        tabId,
        signal: currentSequenceAbort.signal
      });
    } else {
      void dispatchParallel({
        items: data.items,
        tabId,
        signal: currentSequenceAbort.signal
      });
    }
  });

  onMessage(MessageType.CancelDownload, ({ data }) => {
    currentSequenceAbort?.abort();
    currentSequenceAbort = null;
    markVideosCancelled(data.videoIds);

    const progressRemoval = {
      progress: 0,
      progressType: ProgressType.Video,
      isRemoved: true
    } as const;

    for (const videoId of data.videoIds) {
      cancelBackgroundDownload(videoId);
      void cancelIframeScrubSession(videoId);
      signalVideoComplete(videoId);
      removeHostedIframe(downloadIframeId(videoId));
      const trackedTabIds = getTabIdsForVideo(videoId);
      for (const tabId of trackedTabIds) {
        void sendMessage(MessageType.UpdateDownloadProgress, {
          videoId,
          ...progressRemoval
        }, tabId);
      }

      if (currentSequenceTabId && !trackedTabIds.includes(currentSequenceTabId)) {
        void sendMessage(MessageType.UpdateDownloadProgress, {
          videoId,
          ...progressRemoval
        }, currentSequenceTabId);
      }
    }

    currentSequenceTabId = null;
    void removeFromPopupList(data.videoIds);
    void cancelDownloads(data.videoIds);
  });

  onMessage(MessageType.StartBackgroundDownload, async ({ data, sender }) => {
    const tabId = sender.tab?.id ?? -1;
    trackVideoForTab({
      videoId: data.videoId,
      tabId
    });
    await enqueueToPopupList([{
      videoId: data.videoId,
      type: data.type,
      filenameOutput: data.filenameOutput
    }]);
    void startBackgroundDownload({
      request: data,
      tabId
    });
    await sendMessage(MessageType.StartKeepalive, { videoId: data.videoId }, tabId);
  });
}

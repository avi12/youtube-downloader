import { enqueueToPopupList } from "../queue/popup-list";
import { dispatchParallel, dispatchSequentially } from "./playlist-dispatch";
import { MessageType, onMessage } from "@/lib/messaging/messaging";

export let currentSequenceAbort: AbortController | null = null;
export let currentSequenceTabId: number | null = null;

export function registerPlaylistDownloadHandler() {
  onMessage(MessageType.RequestPlaylistDownload, async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return;
    }

    currentSequenceAbort?.abort();
    currentSequenceAbort = null;
    currentSequenceTabId = tabId;

    for (const item of data.items) {
      const hasHeight = !!item.videoFormat?.height;
      await enqueueToPopupList({
        videoId: item.videoId,
        type: item.type,
        filenameOutput: item.filenameOutput,
        quality: hasHeight ? `${item.videoFormat!.height}p` : undefined,
        tabId,
        ...(data.isZipBundle && {
          playlistId: item.playlistId,
          playlistTitle: item.playlistTitle ?? data.playlistTitle
        })
      });
    }

    currentSequenceAbort = new AbortController();

    const dispatchArgs = {
      items: data.items,
      tabId,
      signal: currentSequenceAbort.signal
    };
    if (data.isSequential) {
      void dispatchSequentially(dispatchArgs);
    } else {
      void dispatchParallel(dispatchArgs);
    }
  });
}

export function abortCurrentSequence() {
  currentSequenceAbort?.abort();
  currentSequenceAbort = null;
  currentSequenceTabId = null;
}

export function getCurrentSequenceTabId() {
  return currentSequenceTabId;
}

export function clearCurrentSequenceTabId() {
  currentSequenceTabId = null;
}

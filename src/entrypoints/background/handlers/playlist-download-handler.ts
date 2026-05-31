import { enqueueToPopupList } from "../queue/popup-list";
import { trackVideoForTab } from "../queue/tab-tracker";
import { dispatchParallel, dispatchSequentially } from "./playlist-dispatch";
import { MessageType, onMessage } from "@/lib/messaging/messaging";
import { resolveQualityLabel } from "@/lib/youtube/audio-format-helpers";

export let currentSequenceAbort: AbortController | null = null;
export let currentSequenceTabId: number | null = null;

export function registerPlaylistDownloadHandler() {
  onMessage(MessageType.RequestPlaylistDownload, async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return;
    }

    const sourceUrl = sender.tab?.url;

    currentSequenceAbort?.abort();
    currentSequenceAbort = null;
    currentSequenceTabId = tabId;

    for (const item of data.items) {
      await enqueueToPopupList({
        videoId: item.videoId,
        type: item.type,
        filenameOutput: item.filenameOutput,
        quality: resolveQualityLabel(item),
        tabId,
        sourceUrl,
        ...(data.isZipBundle && {
          playlistId: item.playlistId,
          playlistTitle: item.playlistTitle ?? data.playlistTitle
        })
      });

      if (data.isZipBundle && item.playlistId) {
        trackVideoForTab({
          videoId: item.playlistId,
          tabId
        });
      }
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

import { setPlaylistContext, uncancelStreamTransfer } from "../download/stream-transfer";
import { CrossWorldEvent, emitCrossWorldEvent } from "@/lib/messaging/cross-world-events";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, onMessage } from "@/lib/messaging/messaging";
import { downloadProgressStore } from "@/lib/ui/synced-stores.svelte";
import { ProgressType } from "@/types";

export function registerBackgroundMessageHandlers() {
  onMessage(MessageType.ExecuteDownloadItem, ({ data }) => {
    if (location.pathname !== "/watch") {
      return;
    }

    // Only the offscreen download iframe should respond. Regular user-facing
    // YouTube watch tabs lack ?ytdl=1 and must ignore the broadcast so they
    // don't accidentally re-trigger a foreign download.
    const searchParameters = new URLSearchParams(location.search);
    if (searchParameters.get("ytdl") !== "1" || searchParameters.get("v") !== data.videoId) {
      return;
    }

    if (data.playlistId) {
      setPlaylistContext({
        videoId: data.videoId,
        context: {
          playlistId: data.playlistId,
          playlistTitle: data.playlistTitle ?? "Playlist",
          playlistTotalCount: data.playlistTotalCount ?? 1
        }
      });
    }

    uncancelStreamTransfer(data.videoId);
    void crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadRequest, data);
  });

  const lastReportedProgress = new Map<string, string>();

  onMessage(MessageType.UpdateDownloadProgress, ({ data }) => {
    if (!data.isRemoved) {
      // Dedupe by progress AND progressType so the FFmpeg phase's final
      // progress=1 event isn't dropped just because the video phase already
      // reached progress=1 (different phases share the same progress scale).
      const reportedKey = `${data.progress}|${data.progressType}`;
      if (lastReportedProgress.get(data.videoId) === reportedKey) {
        return;
      }

      // Prevent backwards progress within the same phase — the download may
      // emit slightly out-of-order reports but the display must only advance.
      const currentEntry = downloadProgressStore.get(data.videoId);
      const isSamePhase = currentEntry?.progressType === data.progressType;
      if (isSamePhase && data.progress < (currentEntry?.progress ?? 0)) {
        return;
      }

      lastReportedProgress.set(data.videoId, reportedKey);
    } else {
      lastReportedProgress.delete(data.videoId);
    }

    if (data.isRemoved) {
      if (data.isFailed) {
        downloadProgressStore.setLocal(data.videoId, {
          isDownloading: false,
          isDone: false,
          progress: 0,
          progressType: data.progressType,
          isFailed: true
        });
      } else {
        downloadProgressStore.delete(data.videoId);
      }

      emitCrossWorldEvent({
        type: CrossWorldEvent.ProgressUpdate,
        data
      });
      return;
    }

    const isComplete = data.progress >= 1 && data.progressType === ProgressType.FFmpeg;
    downloadProgressStore.setLocal(data.videoId, {
      isDownloading: !isComplete,
      isDone: isComplete,
      progress: data.progress,
      progressType: data.progressType
    });

    emitCrossWorldEvent({
      type: CrossWorldEvent.ProgressUpdate,
      data
    });
  });
}

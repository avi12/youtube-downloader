import { MessageType, onMessage } from "@/lib/messaging/messaging";
import { SvelteSet } from "svelte/reactivity";

interface CompletedDownload {
  downloadId: number;
  filename: string;
}

type Listener = (videoId: string, completed: CompletedDownload) => void;

const completedByVideoId = $state<Record<string, CompletedDownload>>({});
const listeners = new SvelteSet<Listener>();
let isInitialized = false;

export function initCompletedDownloadsStore() {
  if (isInitialized) {
    return;
  }

  isInitialized = true;
  onMessage(MessageType.WatchDownloadCompleted, ({ data }) => {
    completedByVideoId[data.videoId] = {
      downloadId: data.downloadId,
      filename: data.filename
    };
    for (const listener of listeners) {
      listener(data.videoId, completedByVideoId[data.videoId]);
    }
  });
}

export const completedDownloadsStore = {
  get(videoId: string): CompletedDownload | undefined {
    return completedByVideoId[videoId];
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
};

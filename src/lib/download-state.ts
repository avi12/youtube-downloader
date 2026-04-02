/**
 * Shared reactive download state store.
 * Allows multiple Svelte component instances to observe download
 * progress declaratively via $effect instead of imperative DOM events.
 */

import { SvelteMap } from "svelte/reactivity";

export interface DownloadState {
  isDownloading: boolean;
  isDone: boolean;
  isQueued: boolean;
  progress: number;
  progressType: string;
}

const defaultState: DownloadState = {
  isDownloading: false,
  isDone: false,
  isQueued: false,
  progress: 0,
  progressType: ""
};

export const downloadStates = new SvelteMap<string, DownloadState>();

export function getDownloadState(videoId: string) {
  if (!downloadStates.has(videoId)) {
    downloadStates.set(videoId, { ...defaultState });
  }

  return downloadStates.get(videoId)!;
}

export function updateDownloadProgress(
  videoId: string,
  progress: number,
  progressType: string
) {
  const state = getDownloadState(videoId);
  state.isDownloading = progress < 1;
  state.isDone = progress >= 1;
  state.progress = progress;
  state.progressType = progressType;
  downloadStates.set(videoId, { ...state });
}

export function startDownload(videoId: string) {
  downloadStates.set(videoId, {
    isDownloading: true,
    isDone: false,
    isQueued: false,
    progress: 0,
    progressType: ""
  });
}

export function cancelDownload(videoId: string) {
  downloadStates.set(videoId, { ...defaultState });
}

export function removeDownload(videoId: string) {
  downloadStates.set(videoId, { ...defaultState });
}

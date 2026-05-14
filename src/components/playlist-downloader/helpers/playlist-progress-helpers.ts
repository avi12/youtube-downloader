import type { DownloadProgressState } from "@/lib/ui/synced-stores.svelte";
import { calculateWeightedProgress } from "@/lib/youtube/video-helpers";
import { ProgressType, type DownloadRequest, type VideoData } from "@/types";

export function calculateBatchProgress(
  isDownloading: boolean,
  activeDownloadRequests: DownloadRequest[],
  getProgressEntry: (videoId: string) => DownloadProgressState | undefined,
  totalCount: number,
  currentZipBundleId: string | null,
  activeIndividualDownloadCount: number,
  videoDataMapKeys: Iterable<string>,
  completedBatchProgress: number
) {
  if (isDownloading && totalCount > 0) {
    let sum = 0;
    for (const request of activeDownloadRequests) {
      const entry = getProgressEntry(request.videoId);
      if (!entry || !entry.isDownloading) {
        sum += 100;
        continue;
      }

      sum += calculateWeightedProgress({
        isDownloading: entry.isDownloading,
        progress: entry.progress,
        progressType: entry.progressType
      });
    }

    if (currentZipBundleId) {
      const zipEntry = getProgressEntry(`zip:${currentZipBundleId}`);
      sum += zipEntry?.isDone ? 100 : 0;
      return sum / (totalCount + 1);
    }

    return sum / totalCount;
  }

  if (activeIndividualDownloadCount > 0) {
    let sum = 0;
    for (const videoId of videoDataMapKeys) {
      const entry = getProgressEntry(videoId);
      if (entry?.isDownloading) {
        sum += calculateWeightedProgress({
          isDownloading: entry.isDownloading,
          progress: entry.progress,
          progressType: entry.progressType
        });
      }
    }
    return sum / activeIndividualDownloadCount;
  }

  return completedBatchProgress;
}

export function resolveCurrentPhaseLabel(
  isDownloading: boolean,
  currentZipBundleId: string | null,
  downloadedCount: number,
  totalCount: number,
  activeDownloadVideoId: string | null,
  activeDownloadRequests: DownloadRequest[],
  getProgressEntry: (videoId: string) => DownloadProgressState | undefined,
  getVideoData: (videoId: string) => VideoData | undefined
) {
  if (!isDownloading) {
    return "";
  }

  if (currentZipBundleId && downloadedCount >= totalCount) {
    return "Building ZIP";
  }

  if (!activeDownloadVideoId) {
    return "";
  }

  const entry = getProgressEntry(activeDownloadVideoId);
  const data = getVideoData(activeDownloadVideoId);
  const iVideo = activeDownloadRequests.findIndex(request => request.videoId === activeDownloadVideoId) + 1;
  const videoLabel = data?.title ?? `Video ${iVideo}`;

  return entry?.progressType === ProgressType.FFmpeg
    ? `Processing ${videoLabel}`
    : `Downloading ${videoLabel}`;
}

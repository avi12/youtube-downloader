import { buildInitialDownloadState } from "../watch-button/initial-download-state";
import { videoDataCache } from "./video-data";
import type { DownloadRequest } from "@/types";

export function applyDefaultFormat(request: DownloadRequest) {
  const videoData = videoDataCache.get(request.videoId);
  if (!request.isDefaultFormat || !videoData) {
    return request;
  }

  const { downloadType, videoItag, audioItag, audioTrackId, filename } = buildInitialDownloadState(videoData);
  return {
    ...request,
    type: downloadType,
    videoItag,
    audioItag,
    audioTrackId,
    filenameOutput: filename
  };
}

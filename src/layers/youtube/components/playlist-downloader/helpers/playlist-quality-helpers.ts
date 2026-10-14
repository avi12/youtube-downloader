import type { VideoData } from "@/types";

export function listAvailableHeights(videos: Iterable<VideoData>) {
  const heights = [...videos].flatMap(video => video.videoFormats.map(format => format.height ?? 0));
  return [...new Set(heights.filter(height => height > 0))].toSorted((heightA, heightB) => heightB - heightA);
}

export function findGuaranteedHeight(videos: Iterable<VideoData>) {
  const maxHeights = [...videos].map(video => Math.max(0, ...video.videoFormats.map(format => format.height ?? 0)));
  return maxHeights.length === 0 ? 0 : Math.min(...maxHeights);
}

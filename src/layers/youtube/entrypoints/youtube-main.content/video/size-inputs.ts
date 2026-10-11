import { fetchCaptionWebVttData } from "./caption-fetch";
import { buildVideoMetadata, videoDataCache } from "./video-data";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { base64ToUint8Array } from "@/lib/utils/binary";
import { type DownloadPlanParams, resolveDownloadPlan } from "@/lib/youtube/download-plan";
import type { SizeInputs } from "@/lib/youtube/output-size";
import { preferJpegThumbnail } from "@/lib/youtube/thumbnail-url";
import { DownloadType, type VideoMetadata } from "@/types";

const DECODER = new TextDecoder();
const sizeInputsCache = new Map<string, Promise<SizeInputs | null>>();

async function measureThumbnailBytes(url: string) {
  const response = await fetch(preferJpegThumbnail(url)).catch(() => null);
  if (!response?.ok) {
    return 0;
  }

  return (await response.blob()).size;
}

function collectTags(metadata: VideoMetadata) {
  return [
    metadata.title,
    metadata.artist,
    metadata.albumArtist,
    metadata.album,
    metadata.genres?.join(", "),
    metadata.date
  ].filter((tag): tag is string => !!tag);
}

async function measureSizeInputs(videoId: string, params: DownloadPlanParams) {
  const videoData = videoDataCache.get(videoId);
  if (!videoData) {
    return null;
  }

  const isMuxed = params.type === DownloadType.VideoAndAudio;
  const { captionTracks } = resolveDownloadPlan({
    videoData,
    params
  });
  const [captionData, metadata] = await Promise.all([
    isMuxed
      ? fetchCaptionWebVttData({
        captionTracks,
        videoId,
        captionBytesPerUnit: 0,
        totalExpectedBytes: 0
      })
      : [],
    buildVideoMetadata(videoId)
  ]);
  const isAudioOnly = params.type === DownloadType.Audio;
  const coverBytes = isAudioOnly && metadata?.thumbnailUrl ? await measureThumbnailBytes(metadata.thumbnailUrl) : 0;
  return {
    captionVtts: captionData.map(data => data ? DECODER.decode(base64ToUint8Array(data)) : null),
    coverBytes,
    tags: metadata ? collectTags(metadata) : []
  };
}

export function registerSizeInputsHandler() {
  crossWorldMessenger.onMessage(CrossWorldMessage.MeasureSizeInputs, ({ data }) => {
    const key = JSON.stringify(data);
    const cached = sizeInputsCache.get(key);
    if (cached) {
      return cached;
    }

    const pending = measureSizeInputs(data.videoId, data.params);
    sizeInputsCache.set(key, pending);
    return pending;
  });
}

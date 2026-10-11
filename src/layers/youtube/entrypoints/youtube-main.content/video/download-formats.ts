import { resolveFormatUrl } from "./stream-fetch";
import { type AdaptiveFormatItem, DownloadType, type Prettify } from "@/types";

export { resolveCredentialsWithRetry } from "./credentials-resolver";

type PreResolveCdnUrlsParams = Prettify<{
  type: DownloadType;
  videoFormat: AdaptiveFormatItem | null;
  audioFormat: AdaptiveFormatItem | null;
  extraAudioFormats: AdaptiveFormatItem[];
}>;
export async function preResolveCdnUrls({
  type, videoFormat, audioFormat, extraAudioFormats
}: PreResolveCdnUrlsParams) {
  const videoUrlPromise = type !== DownloadType.Audio ? resolveFormatUrl(videoFormat) : Promise.resolve(null);
  const audioUrlPromise = type !== DownloadType.Video ? resolveFormatUrl(audioFormat) : Promise.resolve(null);
  return Promise.all([
    videoUrlPromise,
    audioUrlPromise,
    ...extraAudioFormats.map(format => resolveFormatUrl(format))
  ]);
}

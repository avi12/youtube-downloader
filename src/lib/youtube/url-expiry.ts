import { required } from "@/lib/required";
import type { AdaptiveFormatItem, SabrConfig } from "@/types";
import { MILLISECONDS_PER_SECOND } from "@/lib/utils/time-units";

const EXPIRY_SAMPLE_SIZE = 3;

function isUrlExpired(url: string) {
  try {
    const expire = new URL(url).searchParams.get("expire");
    return expire ? Date.now() / MILLISECONDS_PER_SECOND > Number(expire) : false;
  } catch {
    return false;
  }
}

export function isVideoDataExpired(videoData: {
  sabrConfig: SabrConfig | null;
  videoFormats: AdaptiveFormatItem[];
  audioFormats: AdaptiveFormatItem[];
}) {
  const sabrUrl = videoData.sabrConfig?.serverAbrStreamingUrl;
  const hasSabrUrl = Boolean(sabrUrl);
  const isSabrUrlExpired = hasSabrUrl && isUrlExpired(required(sabrUrl));
  if (isSabrUrlExpired) {
    return true;
  }

  const formats = [...videoData.videoFormats, ...videoData.audioFormats];
  return formats.slice(0, EXPIRY_SAMPLE_SIZE).some(format => format.url && isUrlExpired(format.url));
}

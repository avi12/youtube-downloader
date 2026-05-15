import type { AdaptiveFormatItem, SabrConfig } from "@/types";

function isUrlExpired(url: string) {
  try {
    const expire = new URL(url).searchParams.get("expire");
    return expire ? Date.now() / 1000 > Number(expire) : false;
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
  const isSabrUrlExpired = sabrUrl && isUrlExpired(sabrUrl);
  if (isSabrUrlExpired) {
    return true;
  }

  const formats = [...videoData.videoFormats, ...videoData.audioFormats];
  return formats.slice(0, 3).some(format => format.url && isUrlExpired(format.url));
}

import type { AdaptiveFormatItem, SabrConfig } from "@/types";

export function buildEffectiveSabrConfig({ sabrConfig, sabrUrl }: {
  sabrConfig: SabrConfig;
  sabrUrl: string | undefined;
}) {
  const isCustomSabrUrl = sabrUrl && sabrUrl !== sabrConfig.serverAbrStreamingUrl;
  if (isCustomSabrUrl) {
    return {
      ...sabrConfig,
      serverAbrStreamingUrl: sabrUrl
    };
  }

  return sabrConfig;
}

export function parseContentLength(format: AdaptiveFormatItem | null) {
  if (!format?.contentLength) {
    return 0;
  }

  return parseInt(format.contentLength, 10);
}

export function estimateFormatBytes(format: AdaptiveFormatItem, referenceFormat: AdaptiveFormatItem): number {
  const referenceBytes = parseContentLength(referenceFormat);
  if (!referenceBytes) {
    return 0;
  }

  const referenceBitrate = referenceFormat.bitrate || 1;
  const formatBitrate = format.bitrate || referenceBitrate;
  return Math.round(referenceBytes * formatBitrate / referenceBitrate);
}

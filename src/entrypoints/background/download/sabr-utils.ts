import type { AdaptiveFormatItem, SabrConfig } from "@/types";

type BuildEffectiveSabrConfigParams = {
  sabrConfig: SabrConfig;
  sabrUrl: string | undefined;
};
export function buildEffectiveSabrConfig({ sabrConfig, sabrUrl }: BuildEffectiveSabrConfigParams) {
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

type EstimateFormatBytesParams = {
  format: AdaptiveFormatItem;
  referenceFormat: AdaptiveFormatItem;
};
export function estimateFormatBytes({ format, referenceFormat }: EstimateFormatBytesParams) {
  const referenceBytes = parseContentLength(referenceFormat);
  if (referenceBytes) {
    const referenceBitrate = referenceFormat.bitrate || 1;
    const formatBitrate = format.bitrate || referenceBitrate;
    return Math.round(referenceBytes * formatBitrate / referenceBitrate);
  }

  return estimateBytesFromBitrate(format);
}

const BITS_PER_BYTE = 8;
const MS_PER_SECOND = 1000;

export function estimateBytesFromBitrate(format: AdaptiveFormatItem) {
  const bitrate = format.bitrate;
  const durationMs = parseInt(format.approxDurationMs ?? "0", 10);
  if (!bitrate || !durationMs) {
    return 0;
  }

  return Math.round(bitrate * durationMs / MS_PER_SECOND / BITS_PER_BYTE);
}

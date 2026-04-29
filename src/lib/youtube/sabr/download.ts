import { adaptiveFormatToSabrFormat, collectReadableStream, createSabrStream } from "./stream-factory";
import type { AdaptiveFormatItem, SabrConfig } from "@/types";

export async function fetchVideoViaSabrStream({ sabrConfig, videoFormat, fetchFn, poToken }: {
  sabrConfig: SabrConfig;
  videoFormat: AdaptiveFormatItem;
  fetchFn: typeof globalThis.fetch;
  poToken: string;
}) {
  const sabrStream = createSabrStream({
    sabrConfig,
    fetchFn,
    poToken
  });
  const targetFormat = adaptiveFormatToSabrFormat(videoFormat);
  const { videoStream } = await sabrStream.start({ videoFormat: targetFormat });
  return collectReadableStream({
    stream: videoStream,
    expectedBytes: parseInt(videoFormat.contentLength, 10)
  });
}

export async function fetchAudioViaSabrStream({ sabrConfig, audioFormat, fetchFn, poToken }: {
  sabrConfig: SabrConfig;
  audioFormat: AdaptiveFormatItem;
  fetchFn: typeof globalThis.fetch;
  poToken: string;
  refreshToken?: RefreshPoToken;
}) {
  const sabrStream = createSabrStream({
    sabrConfig,
    fetchFn,
    poToken
  });
  const refreshInterval = refreshToken ? startPoTokenRefreshLoop(sabrStream, refreshToken) : null;
  try {
    const { audioStream } = await sabrStream.start({
      audioFormat: adaptiveFormatToSabrFormat(audioFormat),
      maxRetries: 10
    });
    return await collectReadableStream({
      stream: audioStream,
      expectedBytes: parseInt(audioFormat.contentLength, 10)
    });
  } finally {
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
  }
}

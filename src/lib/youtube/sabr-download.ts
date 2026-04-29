import {
  adaptiveFormatToSabrFormat,
  collectReadableStream,
  createSabrStream,
  makeTrustTemplateFetch
} from "./sabr-stream-factory";
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

export async function fetchVideoAudioViaSabrStreamBootstrapped({
  sabrConfig, videoFormat, audioFormat, fetchFn, poToken, templateUrl, templateBody, onCallLog
}: {
  sabrConfig: SabrConfig;
  videoFormat: AdaptiveFormatItem;
  audioFormat: AdaptiveFormatItem;
  fetchFn: typeof globalThis.fetch;
  poToken: string;
  templateUrl: string;
  templateBody: Uint8Array;
  onCallLog?: (msg: string) => void;
}) {
  const wrappedFetch = makeTrustTemplateFetch({
    originalFetch: fetchFn,
    templateUrl,
    templateBody,
    onCallLog
  });
  const sabrStream = createSabrStream({
    sabrConfig,
    fetchFn: wrappedFetch,
    poToken
  });
  const videoTarget = adaptiveFormatToSabrFormat(videoFormat);
  const audioTarget = adaptiveFormatToSabrFormat(audioFormat);
  const { videoStream, audioStream } = await sabrStream.start({
    videoFormat: videoTarget,
    audioFormat: audioTarget
  });
  const [videoBytes, audioBytes] = await Promise.all([
    collectReadableStream({
      stream: videoStream,
      expectedBytes: parseInt(videoFormat.contentLength, 10)
    }),
    collectReadableStream({
      stream: audioStream,
      expectedBytes: parseInt(audioFormat.contentLength, 10)
    })
  ]);
  return {
    videoBytes,
    audioBytes
  };
}

export async function fetchAudioViaSabrStream({ sabrConfig, audioFormat, fetchFn, poToken, refreshToken }: {
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

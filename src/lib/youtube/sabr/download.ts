import { adaptiveFormatToSabrFormat, collectReadableStream, createSabrStream } from "./sabr-helpers";
import type { AdaptiveFormatItem, SabrConfig } from "@/types";

export type { SabrStreamResult } from "./sabr-helpers";

export async function fetchVideoViaSabrStream({ sabrConfig, videoFormat, fetchFunction, poToken, signal }: {
  sabrConfig: SabrConfig;
  videoFormat: AdaptiveFormatItem;
  fetchFunction: typeof globalThis.fetch;
  poToken: string;
  signal?: AbortSignal;
}) {
  const sabrStream = createSabrStream({
    sabrConfig,
    fetchFunction,
    poToken
  });
  const { videoStream } = await sabrStream.start({
    videoFormat: adaptiveFormatToSabrFormat(videoFormat),
    maxRetries: 2
  });
  return collectReadableStream({
    stream: videoStream,
    expectedBytes: parseInt(videoFormat.contentLength, 10),
    signal
  });
}

export async function fetchAudioViaSabrStream({ sabrConfig, audioFormat, fetchFunction, poToken, signal }: {
  sabrConfig: SabrConfig;
  audioFormat: AdaptiveFormatItem;
  fetchFunction: typeof globalThis.fetch;
  poToken: string;
  signal?: AbortSignal;
}) {
  const sabrStream = createSabrStream({
    sabrConfig,
    fetchFunction,
    poToken
  });
  const { audioStream } = await sabrStream.start({
    audioFormat: adaptiveFormatToSabrFormat(audioFormat),
    maxRetries: 2
  });
  return collectReadableStream({
    stream: audioStream,
    expectedBytes: parseInt(audioFormat.contentLength, 10),
    signal
  });
}

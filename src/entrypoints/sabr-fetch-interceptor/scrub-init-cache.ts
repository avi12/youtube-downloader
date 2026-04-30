import { extractInit, prependInitIfMissing } from "@/lib/utils/media-init";

const cache = new Map<string, {
  videoInit: Uint8Array;
  audioInit: Uint8Array;
}>();

export function applyInitCache(
  videoId: string,
  videoBytes: Uint8Array,
  audioBytes: Uint8Array,
  videoMimeType: string,
  audioMimeType: string
): {
  videoBytes: Uint8Array;
  audioBytes: Uint8Array;
} {
  const cached = cache.get(videoId);
  const newVideoInit = extractInit(videoBytes, videoMimeType);
  const newAudioInit = extractInit(audioBytes, audioMimeType);
  if (newVideoInit || newAudioInit) {
    cache.set(videoId, {
      videoInit: newVideoInit ?? cached?.videoInit ?? new Uint8Array(),
      audioInit: newAudioInit ?? cached?.audioInit ?? new Uint8Array()
    });
  }

  const videoInit = newVideoInit ?? cached?.videoInit;
  const audioInit = newAudioInit ?? cached?.audioInit;

  return {
    videoBytes: videoInit ? prependInitIfMissing(videoBytes, videoInit, videoMimeType) : videoBytes,
    audioBytes: audioInit ? prependInitIfMissing(audioBytes, audioInit, audioMimeType) : audioBytes
  };
}

export function clearInitCache(videoId: string) {
  cache.delete(videoId);
}

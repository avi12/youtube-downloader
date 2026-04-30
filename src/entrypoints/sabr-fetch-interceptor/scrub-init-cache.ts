import { extractInit, prependInitIfMissing } from "@/lib/utils/media-init";

const cache = new Map<string, {
  videoInit: Uint8Array;
  audioInit: Uint8Array;
}>();

function getSourceBufferInits(): {
  video?: Uint8Array;
  audio?: Uint8Array;
} {
  return window.__ytdlSabrInits ?? {};
}

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
  const sbInits = getSourceBufferInits();
  const newVideoInit = extractInit(videoBytes, videoMimeType);
  const newAudioInit = extractInit(audioBytes, audioMimeType);
  const videoInit = newVideoInit ?? sbInits.video ?? cached?.videoInit;
  const audioInit = newAudioInit ?? sbInits.audio ?? cached?.audioInit;
  if (videoInit || audioInit) {
    cache.set(videoId, {
      videoInit: videoInit ?? new Uint8Array(),
      audioInit: audioInit ?? new Uint8Array()
    });
  }

  return {
    videoBytes: videoInit ? prependInitIfMissing(videoBytes, videoInit, videoMimeType) : videoBytes,
    audioBytes: audioInit ? prependInitIfMissing(audioBytes, audioInit, audioMimeType) : audioBytes
  };
}

export function clearInitCache(videoId: string) {
  cache.delete(videoId);
}

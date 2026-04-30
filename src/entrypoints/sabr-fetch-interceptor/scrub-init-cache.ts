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
  // cached takes priority over sbInits: the cached init comes from the actual
  // SABR stream (segment 0), while sbInits comes from the player which may use
  // a different codec/quality (e.g. AVC when we're fetching AV1).
  const videoInit = newVideoInit ?? cached?.videoInit ?? sbInits.video;
  const audioInit = newAudioInit ?? cached?.audioInit ?? sbInits.audio;
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

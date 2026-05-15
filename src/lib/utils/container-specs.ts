interface ContainerSpec {
  videoCodecs: Set<string>;
  audioCodecs: Set<string>;
  fallbackAudioCodec?: string;
  allowNonNativeVideo?: boolean;
  subtitleCodec?: string;
}

export const CONTAINER_SPECS: Record<string, ContainerSpec> = {
  webm: {
    videoCodecs: new Set(["vp8", "vp9", "av01"]),
    audioCodecs: new Set(["opus", "vorbis"]),
    subtitleCodec: "webvtt"
  },
  mp4: {
    videoCodecs: new Set(["avc1", "hvc1", "hev1", "av01", "mp4v"]),
    audioCodecs: new Set(["mp4a", "ac-3", "ec-3", "flac"]),
    fallbackAudioCodec: "aac",
    allowNonNativeVideo: true,
    subtitleCodec: "mov_text"
  }
};

export function extractBaseCodec(mimeType: string) {
  return mimeType.match(/codecs="?([^",.;]+)/i)?.[1]?.toLowerCase() ?? "";
}

export function getOutputExtension({ videoMimeType, audioMimeType, userExtension }: {
  videoMimeType: string;
  audioMimeType: string;
  userExtension: string;
}) {
  const spec: ContainerSpec | undefined = CONTAINER_SPECS[userExtension];
  if (!spec) {
    return userExtension;
  }

  const videoCodec = extractBaseCodec(videoMimeType);
  const audioCodec = extractBaseCodec(audioMimeType);
  const videoOk = spec.videoCodecs.has(videoCodec) || !!spec.allowNonNativeVideo;
  const audioOk = spec.audioCodecs.has(audioCodec) || spec.fallbackAudioCodec !== undefined;

  return videoOk && audioOk ? userExtension : "mkv";
}

export function isVideoNativeForContainer({ videoMimeType, targetExtension }: {
  videoMimeType: string;
  targetExtension: string;
}) {
  const spec = CONTAINER_SPECS[targetExtension];
  if (!spec) {
    return true;
  }

  return spec.videoCodecs.has(extractBaseCodec(videoMimeType));
}

export function isCompatibleForRemux({ videoMimeType, audioMimeType, targetExtension }: {
  videoMimeType: string;
  audioMimeType: string;
  targetExtension: string;
}) {
  const spec = CONTAINER_SPECS[targetExtension];
  if (!spec) {
    return true;
  }

  const videoOk = spec.videoCodecs.has(extractBaseCodec(videoMimeType)) || !!spec.allowNonNativeVideo;
  const audioOk = spec.audioCodecs.has(extractBaseCodec(audioMimeType)) || spec.fallbackAudioCodec !== undefined;
  return videoOk && audioOk;
}

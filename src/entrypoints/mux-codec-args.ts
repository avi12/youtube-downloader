import { CONTAINER_SPECS, extractBaseCodec, videoContainers } from "@/lib/utils/containers";

export function resolveAudioCodec(audioMimeType: string, targetExtension: string) {
  const spec = CONTAINER_SPECS[targetExtension];
  if (!spec) {
    return "copy";
  }

  const codec = extractBaseCodec(audioMimeType);
  return spec.audioCodecs.has(codec) ? "copy" : (spec.fallbackAudioCodec ?? "copy");
}

export function resolveSubtitleCodec(targetExtension: string) {
  return CONTAINER_SPECS[targetExtension]?.subtitleCodec ?? "webvtt";
}

export function buildRemuxArgs({
  inputFilename,
  outputFilename,
  targetExtension,
  audioMimeType
}: {
  inputFilename: string;
  outputFilename: string;
  targetExtension: string;
  audioMimeType: string | undefined;
}) {
  const audioCodec = resolveAudioCodec(audioMimeType ?? "", targetExtension);
  const args = ["-i", inputFilename, "-map", "0", "-c:v", "copy", "-c:a", audioCodec];
  if (videoContainers.includes(targetExtension)) {
    args.push("-c:s", resolveSubtitleCodec(targetExtension));
  }

  args.push(outputFilename);
  return args;
}

import type { ExtraAudioInput, SubtitleInput } from "./concat-extra-inputs";

export type { ExtraAudioInput, SubtitleInput } from "./concat-extra-inputs";

export function buildFinalMuxArgs({
  concatListName, extraAudioInputs, subtitleInputs, primaryAudioLabel, totalDurationSec, outputFfmpegName
}: {
  concatListName: string;
  extraAudioInputs: ExtraAudioInput[];
  subtitleInputs: SubtitleInput[];
  primaryAudioLabel: string | null | undefined;
  totalDurationSec: number | null | undefined;
  outputFfmpegName: string;
}): string[] {
  const args: string[] = ["-y", "-f", "concat", "-safe", "0", "-i", concatListName];

  for (const input of extraAudioInputs) {
    args.push("-i", input.filename);
  }

  for (const input of subtitleInputs) {
    args.push("-i", input.filename);
  }

  args.push("-map", "0:v:0", "-map", "0:a:0");
  for (let i = 0; i < extraAudioInputs.length; i++) {
    args.push("-map", `${i + 1}:a:0`);
  }

  const subtitleOffset = 1 + extraAudioInputs.length;
  for (let i = 0; i < subtitleInputs.length; i++) {
    args.push("-map", `${subtitleOffset + i}:s:0`);
  }

  // Primary audio (0:a) is already AAC from per-segment mux — stream-copy it.
  // Extra audio tracks may still be Opus → transcode to AAC per-track.
  args.push("-c:v", "copy", "-c:a:0", "copy");
  for (let i = 0; i < extraAudioInputs.length; i++) {
    const isExtraOpus = extraAudioInputs[i]?.mimeType.includes("webm") ?? false;
    args.push(`-c:a:${i + 1}`, isExtraOpus ? "aac" : "copy");
  }

  if (subtitleInputs.length > 0) {
    args.push("-c:s", "srt");
  }

  const audioLabels = [primaryAudioLabel ?? "", ...extraAudioInputs.map(input => input.label)];
  for (const [i, label] of audioLabels.entries()) {
    if (label) {
      args.push(`-metadata:s:a:${i}`, `title=${label}`);
    }
  }

  for (const [i, sub] of subtitleInputs.entries()) {
    args.push(`-metadata:s:s:${i}`, `language=${sub.languageCode}`);

    if (sub.label) {
      args.push(`-metadata:s:s:${i}`, `title=${sub.label}`);
    }
  }

  if (totalDurationSec && totalDurationSec > 0) {
    args.push("-t", String(totalDurationSec));
  }

  args.push(outputFfmpegName);
  return args;
}

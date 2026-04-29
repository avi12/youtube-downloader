export interface AudioTrackFile {
  filename: string;
  label: string;
}

export interface SubtitleFile {
  filename: string;
  languageCode: string;
  label: string;
}

export function buildFfmpegArgs({
  videoFilename,
  primaryAudioFilename,
  extraAudioTracks,
  subtitleFiles,
  outputFilename,
  outputExtension,
  audioMimeType,
  primaryAudioLabel,
  additionalAudioLabels
}: {
  videoFilename: string;
  primaryAudioFilename: string;
  extraAudioTracks: AudioTrackFile[];
  subtitleFiles: SubtitleFile[];
  outputFilename: string;
  outputExtension: string;
  audioMimeType: string;
  primaryAudioLabel: string;
  additionalAudioLabels: string[];
}) {
  const args = ["-i", videoFilename, "-i", primaryAudioFilename];

  for (const { filename } of extraAudioTracks) {
    args.push("-i", filename);
  }

  for (const { filename } of subtitleFiles) {
    args.push("-i", filename);
  }

  args.push("-map", "0:v:0");
  for (let i = 0; i <= extraAudioTracks.length; i++) {
    args.push("-map", `${i + 1}:a:0`);
  }

  const subtitleInputOffset = 2 + extraAudioTracks.length;
  for (let i = 0; i < subtitleFiles.length; i++) {
    args.push("-map", `${subtitleInputOffset + i}:s:0`);
  }

  const isOpusAudio = audioMimeType.includes("webm") || audioMimeType.includes("opus");
  const needsAacTranscode = outputExtension === "mp4" && isOpusAudio;
  args.push("-c:v", "copy");

  if (needsAacTranscode) {
    args.push("-c:a", "aac", "-b:a", "192k");
  } else {
    args.push("-c:a", "copy");
  }

  if (subtitleFiles.length > 0) {
    args.push("-c:s", "srt");
  }

  const audioTrackLabels = [primaryAudioLabel, ...additionalAudioLabels];
  for (let i = 0; i < audioTrackLabels.length; i++) {
    const label = audioTrackLabels[i];
    if (label) {
      args.push(`-metadata:s:a:${i}`, `title=${label}`);
    }
  }

  for (const [i, subtitle] of subtitleFiles.entries()) {
    args.push(`-metadata:s:s:${i}`, `language=${subtitle.languageCode}`);

    if (subtitle.label) {
      args.push(`-metadata:s:s:${i}`, `title=${subtitle.label}`);
    }
  }

  args.push(outputFilename);
  return args;
}

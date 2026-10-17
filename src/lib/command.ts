export enum Placeholder {
  Video = "{video}",
  Audio = "{audio}",
  Captions = "{captions}"
}

export const PLACEHOLDER_FILENAMES: Record<Placeholder, string> = {
  [Placeholder.Video]: "video.mp4",
  [Placeholder.Audio]: "audio.m4a",
  [Placeholder.Captions]: "captions.vtt"
};

const ARGUMENT_PATTERN = /"([^"]*)"|'([^']*)'|(\S+)/g;

export function tokenize(command: string) {
  return Array.from(
    command.matchAll(ARGUMENT_PATTERN),
    ([, doubleQuoted, singleQuoted, bare]) => doubleQuoted ?? singleQuoted ?? bare ?? ""
  );
}

export function usedPlaceholders(command: string) {
  return Object.values(Placeholder).filter(placeholder => command.includes(placeholder));
}

export function substitutePlaceholders(args: string[]) {
  return args.map(arg => Object.values(Placeholder).reduce(
    (result, placeholder) => result.replaceAll(placeholder, PLACEHOLDER_FILENAMES[placeholder]),
    arg
  ));
}

export const PRESETS = [
  { label: "Merge video + audio", command: "-i {video} -i {audio} -c copy output.mp4" },
  { label: "Audio only (MP3)", command: "-i {audio} -vn -c:a libmp3lame -q:a 2 output.mp3" },
  { label: "Captions only (SRT)", command: "-i {captions} output.srt" },
  { label: "Screenshot at 10s", command: "-ss 10 -i {video} -frames:v 1 screenshot.png" },
  { label: "Clip 10s-20s", command: "-ss 10 -to 20 -i {video} -i {audio} -c copy clip.mp4" }
];

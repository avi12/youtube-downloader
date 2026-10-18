const ARGUMENT_PATTERN = /"([^"]*)"|'([^']*)'|(\S+)/g;
export const URL_TOKEN = "URL";

export function tokenize(command: string) {
  return Array.from(
    command.matchAll(ARGUMENT_PATTERN),
    ([, doubleQuoted, singleQuoted, bare]) => doubleQuoted ?? singleQuoted ?? bare ?? ""
  );
}

export const PRESETS = [
  { label: "Best video + audio", command: `yt-dlp ${URL_TOKEN}` },
  { label: "720p at most", command: `yt-dlp -f "bv*[height<=720]+ba/b[height<=720]" ${URL_TOKEN}` },
  { label: "Audio only (MP3)", command: `yt-dlp -x --audio-format mp3 ${URL_TOKEN}` },
  { label: "Captions only (SRT)", command: `yt-dlp --skip-download --write-subs --write-auto-subs --sub-langs en --convert-subs srt ${URL_TOKEN}` },
  { label: "Clip 10s-20s", command: `yt-dlp --download-sections "*10-20" ${URL_TOKEN}` },
  { label: "List formats", command: `yt-dlp -F ${URL_TOKEN}` }
];

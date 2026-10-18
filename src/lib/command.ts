const ARGUMENT_PATTERN = /"([^"]*)"|'([^']*)'|(\S+)/g;
export const URL_TOKEN = "URL";

export function tokenize(command: string) {
  return Array.from(
    command.matchAll(ARGUMENT_PATTERN),
    ([, doubleQuoted, singleQuoted, bare]) => doubleQuoted ?? singleQuoted ?? bare ?? ""
  );
}

export const PRESETS: { label: string; command: string; ffmpegCommand?: string }[] = [
  { label: "Best video + audio", command: `yt-dlp ${URL_TOKEN}` },
  { label: "720p at most", command: `yt-dlp -f "bv*[height<=720]+ba/b[height<=720]" ${URL_TOKEN}` },
  { label: "Audio only (MP3) with cover", command: `yt-dlp -x --audio-format mp3 --embed-thumbnail --embed-metadata ${URL_TOKEN}` },
  { label: "Captions only (SRT)", command: `yt-dlp --skip-download --write-subs --write-auto-subs --sub-langs en --convert-subs srt ${URL_TOKEN}` },
  { label: "Video with subtitles and chapters", command: `yt-dlp --embed-subs --sub-langs en --embed-chapters --embed-metadata ${URL_TOKEN}` },
  { label: "Clip 10s-20s", command: `yt-dlp --download-sections "*10-20" ${URL_TOKEN}` },
  { label: "Whole playlist as MP3", command: `yt-dlp -x --audio-format mp3 -o "%(playlist)s/%(playlist_index)02d - %(title)s.%(ext)s" ${URL_TOKEN}` },
  { label: "Thumbnail only", command: `yt-dlp --skip-download --write-thumbnail ${URL_TOKEN}` },
  { label: "Snapshot at 5s (PNG)", command: `yt-dlp -f "bv*[height<=720][vcodec^=avc1]" ${URL_TOKEN}`, ffmpegCommand: "-ss 00:00:05 -i {input1} -frames:v 1 snapshot.png" },
  { label: "List formats", command: `yt-dlp -F ${URL_TOKEN}` }
];

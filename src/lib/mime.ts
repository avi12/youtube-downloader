const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: "video/mp4",
  m4a: "audio/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  flv: "video/x-flv",
  avi: "video/x-msvideo",
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  ogg: "audio/ogg",
  flac: "audio/flac",
  wav: "audio/wav",
  aac: "audio/aac",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  srt: "application/x-subrip",
  vtt: "text/vtt",
  ass: "text/x-ssa",
  json: "application/json",
  description: "text/plain"
};

export function mimeTypeForFile(name: string) {
  return MIME_BY_EXTENSION[name.split(".").at(-1)?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

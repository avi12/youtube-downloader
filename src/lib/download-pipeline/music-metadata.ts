import { tryUnlink } from "./ffmpeg-instance";
import type { VideoMetadata } from "@/types";
import type { FFmpegCoreModule } from "@ffmpeg/types";
import { getFileExtension, getCompatibleFilename } from "~/lib/utils/containers";

function matchesMagicBytes({ data, bytes, offset = 0 }: {
  data: Uint8Array;
  bytes: number[];
  offset?: number;
}) {
  return bytes.every((byte, i) => data[offset + i] === byte);
}

const jpegMagicBytes = [0xFF, 0xD8, 0xFF];
const pngMagicBytes = [0x89, 0x50, 0x4E, 0x47];
const riffMagicBytes = [0x52, 0x49, 0x46, 0x46];
const webpMagicBytes = [0x57, 0x45, 0x42, 0x50];
const webpMagicOffset = 8;

function detectImageExtension(data: Uint8Array) {
  if (matchesMagicBytes({ data, bytes: jpegMagicBytes })) {
    return "jpg";
  }

  if (matchesMagicBytes({ data, bytes: pngMagicBytes })) {
    return "png";
  }

  if (matchesMagicBytes({ data, bytes: riffMagicBytes })
    && matchesMagicBytes({ data, bytes: webpMagicBytes, offset: webpMagicOffset })) {
    return "webp";
  }

  return "jpg";
}

function sanitizeForFFmpeg(value: string) {
  return value.replaceAll(/[\n\r"\\]/g, " ").trim();
}

// FFmpeg WASM's default build hangs indefinitely on the WebP decoder for attached_pic
// transcoding, so swap YouTube's WebP thumbnail path for the JPEG variant.
function preferJpegThumbnail(url: string) {
  return url
    .replace("/vi_webp/", "/vi/")
    .replace(/\.webp(\?|$)/, ".jpg$1");
}

async function fetchThumbnail(url: string) {
  try {
    const response = await fetch(preferJpegThumbnail(url));
    if (!response.ok) {
      return null;
    }

    const data = new Uint8Array(await response.arrayBuffer());
    return { data, extension: detectImageExtension(data) };
  } catch {
    return null;
  }
}

export async function embedMusicMetadata({ audioData, filenameOutput, sourceExtension, metadata, ffmpeg }: {
  audioData: Uint8Array;
  filenameOutput: string;
  sourceExtension: string;
  metadata: VideoMetadata;
  ffmpeg: FFmpegCoreModule;
}) {
  const outputExtension = getFileExtension(filenameOutput) || sourceExtension;
  const inputFilename = `input.${sourceExtension}`;
  const outputFilename = getCompatibleFilename(filenameOutput);

  ffmpeg.FS.writeFile(inputFilename, audioData);

  const ffmpegArgs = ["-i", inputFilename];

  // WebM (Matroska) doesn't hold attached_pic like MP4/FLAC, so skip cover art when either side is WebM.
  const isWebmSource = sourceExtension === "weba" || sourceExtension === "webm";
  const isWebmOutput = outputExtension === "weba" || outputExtension === "webm";
  let isCoverArtPresent = false;
  let coverFilename = "";
  if (metadata.thumbnailUrl && !isWebmSource && !isWebmOutput) {
    const thumbnail = await fetchThumbnail(metadata.thumbnailUrl);
    if (thumbnail) {
      coverFilename = `cover.${thumbnail.extension}`;
      ffmpeg.FS.writeFile(coverFilename, thumbnail.data);
      ffmpegArgs.push("-i", coverFilename);
      isCoverArtPresent = true;
    }
  }

  ffmpegArgs.push("-map", "0:a");

  if (isCoverArtPresent) {
    ffmpegArgs.push("-map", "1");
    const isJpeg = coverFilename.endsWith(".jpg");
    ffmpegArgs.push("-c:v", isJpeg ? "copy" : "mjpeg");
    ffmpegArgs.push("-disposition:v", "attached_pic");
  }

  // FLAC can't hold AAC/Opus, so re-encode to FLAC; all other supported containers can remux the source stream.
  const audioCodec = outputExtension === "flac" ? "flac" : "copy";
  ffmpegArgs.push("-c:a", audioCodec);
  ffmpegArgs.push("-metadata", `title=${sanitizeForFFmpeg(metadata.title)}`);
  ffmpegArgs.push("-metadata", `artist=${sanitizeForFFmpeg(metadata.artist)}`);

  if (metadata.albumArtist) {
    ffmpegArgs.push("-metadata", `album_artist=${sanitizeForFFmpeg(metadata.albumArtist)}`);
  }

  if (metadata.album) {
    ffmpegArgs.push("-metadata", `album=${sanitizeForFFmpeg(metadata.album)}`);
  }

  if (metadata.genres?.length) {
    ffmpegArgs.push("-metadata", `genre=${sanitizeForFFmpeg(metadata.genres.join(", "))}`);
  }

  if (metadata.date) {
    ffmpegArgs.push("-metadata", `date=${metadata.date}`);
  }

  ffmpegArgs.push(outputFilename);

  try {
    const exitCode = ffmpeg.exec(...ffmpegArgs);
    if (exitCode !== 0) {
      return audioData;
    }

    const taggedOutput = ffmpeg.FS.readFile(outputFilename, { encoding: "binary" });
    if (typeof taggedOutput === "string" || taggedOutput.byteLength === 0) {
      return audioData;
    }

    return taggedOutput;
  } finally {
    tryUnlink({ ffmpeg, filename: inputFilename });
    tryUnlink({ ffmpeg, filename: outputFilename });

    if (isCoverArtPresent) {
      tryUnlink({ ffmpeg, filename: coverFilename });
    }
  }
}

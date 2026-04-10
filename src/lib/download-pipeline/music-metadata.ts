import { getFileExtension, getCompatibleFilename } from "../utils";
import type { VideoMetadata } from "@/types";
import type { FFmpegCoreModule } from "@ffmpeg/types";

function matchesMagicBytes(data: Uint8Array, bytes: number[], offset = 0) {
  return bytes.every((byte, i) => data[offset + i] === byte);
}

const jpegMagicBytes = [0xFF, 0xD8, 0xFF];
const pngMagicBytes = [0x89, 0x50, 0x4E, 0x47];
const riffMagicBytes = [0x52, 0x49, 0x46, 0x46];
const webpMagicBytes = [0x57, 0x45, 0x42, 0x50];
const webpMagicOffset = 8;

function detectImageExtension(data: Uint8Array) {
  if (matchesMagicBytes(data, jpegMagicBytes)) {
    return "jpg";
  }

  if (matchesMagicBytes(data, pngMagicBytes)) {
    return "png";
  }

  if (matchesMagicBytes(data, riffMagicBytes) && matchesMagicBytes(data, webpMagicBytes, webpMagicOffset)) {
    return "webp";
  }

  return "jpg";
}

async function fetchThumbnail(url: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const data = new Uint8Array(await response.arrayBuffer());
    return { data, extension: detectImageExtension(data) };
  } catch {
    return null;
  }
}

export async function embedMusicMetadata(
  audioData: Uint8Array,
  filenameOutput: string,
  metadata: VideoMetadata,
  ffmpeg: FFmpegCoreModule
) {
  const audioExtension = getFileExtension(filenameOutput) || "m4a";
  const inputFilename = `input.${audioExtension}`;
  const outputFilename = getCompatibleFilename(filenameOutput);

  ffmpeg.FS.writeFile(inputFilename, audioData);

  const ffmpegArgs = ["-i", inputFilename];

  const isWebmAudio = audioExtension === "weba" || audioExtension === "webm";
  let isCoverArtPresent = false;
  let coverFilename = "";
  if (metadata.thumbnailUrl && !isWebmAudio) {
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

  ffmpegArgs.push("-c:a", "copy");
  ffmpegArgs.push("-metadata", `title=${metadata.title}`);
  ffmpegArgs.push("-metadata", `artist=${metadata.artist}`);

  if (metadata.albumArtist) {
    ffmpegArgs.push("-metadata", `album_artist=${metadata.albumArtist}`);
  }

  if (metadata.album) {
    ffmpegArgs.push("-metadata", `album=${metadata.album}`);
  }

  if (metadata.genre) {
    ffmpegArgs.push("-metadata", `genre=${metadata.genre}`);
  }

  if (metadata.date) {
    ffmpegArgs.push("-metadata", `date=${metadata.date}`);
  }

  if (metadata.description) {
    ffmpegArgs.push("-metadata", `comment=${metadata.description}`);
  }

  ffmpegArgs.push(outputFilename);

  const exitCode = ffmpeg.exec(...ffmpegArgs);
  if (exitCode !== 0) {
    ffmpeg.FS.unlink(inputFilename);
    return audioData;
  }

  const taggedOutput = ffmpeg.FS.readFile(outputFilename, { encoding: "binary" });
  ffmpeg.FS.unlink(inputFilename);
  ffmpeg.FS.unlink(outputFilename);

  if (isCoverArtPresent) {
    ffmpeg.FS.unlink(coverFilename);
  }

  if (typeof taggedOutput === "string" || taggedOutput.byteLength === 0) {
    return audioData;
  }

  return taggedOutput;
}

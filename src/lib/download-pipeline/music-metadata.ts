import { getFFmpeg, tryUnlink } from "./ffmpeg-instance";
import { fetchThumbnail } from "./thumbnail-fetcher";
import { getFileExtension, getCompatibleFilename } from "@/lib/utils/containers";
import type { VideoMetadata } from "@/types";

function sanitizeForFFmpeg(value: string) {
  return value.replaceAll(/[\n\r"\\]/g, " ").trim();
}

function buildMetadataArgs(metadata: VideoMetadata) {
  const args: string[] = ["-metadata", `title=${sanitizeForFFmpeg(metadata.title)}`, "-metadata", `artist=${sanitizeForFFmpeg(metadata.artist)}`];
  if (metadata.albumArtist) {
    args.push("-metadata", `album_artist=${sanitizeForFFmpeg(metadata.albumArtist)}`);
  }

  if (metadata.album) {
    args.push("-metadata", `album=${sanitizeForFFmpeg(metadata.album)}`);
  }

  if (metadata.genres?.length) {
    args.push("-metadata", `genre=${sanitizeForFFmpeg(metadata.genres.join(", "))}`);
  }

  if (metadata.date) {
    args.push("-metadata", `date=${metadata.date}`);
  }

  return args;
}

export async function embedMusicMetadata({ audioData, filenameOutput, sourceExtension, metadata }: {
  audioData: Uint8Array;
  filenameOutput: string;
  sourceExtension: string;
  metadata: VideoMetadata;
}) {
  const ffmpeg = getFFmpeg();
  const outputExtension = getFileExtension(filenameOutput) || sourceExtension;
  const inputFilename = `input.${sourceExtension}`;
  const outputFilename = getCompatibleFilename(filenameOutput);

  await ffmpeg.FS.writeFile(inputFilename, audioData);

  const ffmpegArgs = ["-i", inputFilename];

  const isWebmSource = sourceExtension === "weba" || sourceExtension === "webm";
  const isWebmOutput = outputExtension === "weba" || outputExtension === "webm";
  let isCoverArtPresent = false;
  let coverFilename = "";
  if (metadata.thumbnailUrl && !isWebmSource && !isWebmOutput) {
    const thumbnail = await fetchThumbnail(metadata.thumbnailUrl);
    if (thumbnail) {
      coverFilename = `cover.${thumbnail.extension}`;
      await ffmpeg.FS.writeFile(coverFilename, thumbnail.data);
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

  const audioCodec = outputExtension === "flac" ? "flac" : "copy";
  ffmpegArgs.push("-c:a", audioCodec);
  ffmpegArgs.push(...buildMetadataArgs(metadata));
  ffmpegArgs.push(outputFilename);

  try {
    const exitCode = await ffmpeg.exec(...ffmpegArgs);
    if (exitCode !== 0) {
      return audioData;
    }

    const taggedOutput = await ffmpeg.FS.readFile(outputFilename);
    if (taggedOutput.byteLength === 0) {
      return audioData;
    }

    return taggedOutput;
  } finally {
    tryUnlink(inputFilename);
    tryUnlink(outputFilename);

    if (isCoverArtPresent) {
      tryUnlink(coverFilename);
    }
  }
}

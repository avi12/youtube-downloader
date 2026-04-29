import { tryUnlink } from "./ffmpeg-instance";
import { fetchThumbnail } from "./thumbnail-fetcher";
import { getFileExtension, getCompatibleFilename } from "@/lib/utils/containers";
import type { VideoMetadata } from "@/types";
import type { FFmpegCoreModule } from "@ffmpeg/types";

function sanitizeForFFmpeg(value: string) {
  return value.replaceAll(/[\n\r"\\]/g, " ").trim();
}

function buildMetadataArgs(metadata: VideoMetadata): string[] {
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

  const audioCodec = outputExtension === "flac" ? "flac" : "copy";
  ffmpegArgs.push("-c:a", audioCodec);
  ffmpegArgs.push(...buildMetadataArgs(metadata));
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
    tryUnlink({
      ffmpeg,
      filename: inputFilename
    });
    tryUnlink({
      ffmpeg,
      filename: outputFilename
    });

    if (isCoverArtPresent) {
      tryUnlink({
        ffmpeg,
        filename: coverFilename
      });
    }
  }
}

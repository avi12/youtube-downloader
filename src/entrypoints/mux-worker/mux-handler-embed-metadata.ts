import { postResult, state, tryUnlink } from "./mux-state";
import { fetchThumbnail, sanitizeForFFmpeg } from "./mux-thumbnail";
import type { EmbedMetadataJob } from "@/lib/download-pipeline/mux-worker-types";
import { getCompatibleFilename, getFileExtension } from "@/lib/utils/containers";

const FLAC_CODEC = "flac";

export async function handleEmbedMetadata(job: EmbedMetadataJob) {
  const { audioData, filenameOutput, sourceExtension, metadata, thumbnailUrl, videoId, tabId } = job;
  state.currentVideoId = videoId;
  state.currentTabId = tabId;
  const outputExtension = getFileExtension(filenameOutput) || sourceExtension;
  const inputFilename = `input.${sourceExtension}`;
  const outputFilename = getCompatibleFilename(filenameOutput);

  state.progressOffset = 0;
  state.progressScale = 1;

  let coverFilename = "";
  let isCoverArtPresent = false;

  state.ffmpeg!.FS.writeFile(inputFilename, new Uint8Array(audioData));

  const ffmpegArgs = ["-i", inputFilename];
  const isWebmSource = sourceExtension === "weba" || sourceExtension === "webm";
  const isWebmOutput = outputExtension === "weba" || outputExtension === "webm";
  if (thumbnailUrl && !isWebmSource && !isWebmOutput) {
    const thumbnail = await fetchThumbnail(thumbnailUrl);
    if (thumbnail) {
      coverFilename = `cover.${thumbnail.extension}`;
      state.ffmpeg!.FS.writeFile(coverFilename, thumbnail.data);
      ffmpegArgs.push("-i", coverFilename);
      isCoverArtPresent = true;
    }
  }

  ffmpegArgs.push("-map", "0:a");

  if (isCoverArtPresent) {
    ffmpegArgs.push("-map", "1");
    ffmpegArgs.push("-c:v", coverFilename.endsWith(".jpg") ? "copy" : "mjpeg");
    ffmpegArgs.push("-disposition:v", "attached_pic");
  }

  ffmpegArgs.push("-c:a", outputExtension === FLAC_CODEC ? FLAC_CODEC : "copy");
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
    const exitCode = state.ffmpeg!.exec(...ffmpegArgs);
    if (exitCode !== 0) {
      postResult(new Uint8Array(audioData));
      return;
    }

    const output = state.ffmpeg!.FS.readFile(outputFilename, { encoding: "binary" });
    if (typeof output === "string" || output.byteLength === 0) {
      postResult(new Uint8Array(audioData));
      return;
    }

    postResult(output);
  } finally {
    tryUnlink(inputFilename);
    tryUnlink(outputFilename);

    if (isCoverArtPresent) {
      tryUnlink(coverFilename);
    }
  }
}

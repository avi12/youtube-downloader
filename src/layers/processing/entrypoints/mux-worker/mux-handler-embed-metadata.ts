import { required } from "@/lib/required";
import { prepareCoverArt } from "./mux-cover-art";
import { buildInputArgs } from "./mux-ffmpeg-args";
import { postResult, state, tryUnlink } from "./mux-state";
import { sanitizeForFFmpeg } from "./mux-thumbnail";
import type { EmbedMetadataJob } from "@/lib/download-pipeline/mux-worker-types";
import { getCompatibleFilename, getFileExtension, resolveAudioCodec } from "@/lib/utils/containers";

const INPUT_FILENAME_PREFIX = "input";

export async function handleEmbedMetadata(job: EmbedMetadataJob) {
  const { audioData, filenameOutput, sourceExtension, audioMimeType, metadata, thumbnailUrl, videoId, tabId } = job;
  state.currentVideoId = videoId;
  state.currentTabId = tabId;
  const outputExtension = getFileExtension(filenameOutput) || sourceExtension;
  const inputFilename = `${INPUT_FILENAME_PREFIX}.${sourceExtension}`;
  const outputFilename = getCompatibleFilename(filenameOutput);

  state.progressOffset = 0;
  state.progressScale = 1;

  required(state.ffmpeg).FS.writeFile(inputFilename, new Uint8Array(audioData));

  const cover = await prepareCoverArt({
    thumbnailUrl,
    outputExtension
  });
  const ffmpegArgs = [...buildInputArgs(inputFilename), ...cover.inputArgs, "-map", "0:a", ...cover.outputArgs];

  const audioCodec = resolveAudioCodec({
    audioMimeType: audioMimeType ?? "",
    targetExtension: outputExtension
  });
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
    const exitCode = required(state.ffmpeg).exec(...ffmpegArgs);
    const isExecFailed = exitCode !== 0;
    if (isExecFailed) {
      postResult(new Uint8Array(audioData));
      return;
    }

    const output = required(state.ffmpeg).FS.readFile(outputFilename, { encoding: "binary" });
    const isEmptyOutput = typeof output === "string" || output.byteLength === 0;
    if (isEmptyOutput) {
      postResult(new Uint8Array(audioData));
      return;
    }

    postResult(output);
  } finally {
    tryUnlink(inputFilename);
    tryUnlink(outputFilename);

    if (cover.filename) {
      tryUnlink(cover.filename);
    }
  }
}

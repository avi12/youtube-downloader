import { buildInputArgs, resolveAudioCodec } from "./mux-ffmpeg-args";
import { postResult, state, tryUnlink } from "./mux-state";
import { fetchThumbnail, sanitizeForFFmpeg } from "./mux-thumbnail";
import type { EmbedMetadataJob } from "@/lib/download-pipeline/mux-worker-types";
import { getCompatibleFilename, getFileExtension } from "@/lib/utils/containers";

const WEBM_AUDIO_OUTPUT_EXTENSIONS = new Set(["weba", "webm"]);
const JPEG_EXTENSION = "jpg";
const FFMPEG_CODEC_COPY = "copy";
const FFMPEG_CODEC_MJPEG = "mjpeg";
const COVER_FILENAME_PREFIX = "cover";
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

  let coverFilename = "";
  let isCoverArtPresent = false;

  state.ffmpeg!.FS.writeFile(inputFilename, new Uint8Array(audioData));

  const ffmpegArgs = [...buildInputArgs(inputFilename)];
  const isWebmOutput = WEBM_AUDIO_OUTPUT_EXTENSIONS.has(outputExtension);
  const isEmbeddableThumbnail = thumbnailUrl && !isWebmOutput;
  if (isEmbeddableThumbnail) {
    const thumbnail = await fetchThumbnail(thumbnailUrl);
    if (thumbnail) {
      coverFilename = `${COVER_FILENAME_PREFIX}.${thumbnail.extension}`;
      state.ffmpeg!.FS.writeFile(coverFilename, thumbnail.data);
      ffmpegArgs.push(...buildInputArgs(coverFilename));
      isCoverArtPresent = true;
    }
  }

  ffmpegArgs.push("-map", "0:a");

  if (isCoverArtPresent) {
    ffmpegArgs.push("-map", "1");
    ffmpegArgs.push("-c:v", coverFilename.endsWith(`.${JPEG_EXTENSION}`) ? FFMPEG_CODEC_COPY : FFMPEG_CODEC_MJPEG);
    ffmpegArgs.push("-disposition:v", "attached_pic");
  }

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
    const exitCode = state.ffmpeg!.exec(...ffmpegArgs);
    const isExecFailed = exitCode !== 0;
    if (isExecFailed) {
      postResult(new Uint8Array(audioData));
      return;
    }

    const output = state.ffmpeg!.FS.readFile(outputFilename, { encoding: "binary" });
    const isEmptyOutput = typeof output === "string" || output.byteLength === 0;
    if (isEmptyOutput) {
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

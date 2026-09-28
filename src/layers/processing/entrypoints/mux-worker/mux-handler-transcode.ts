import { buildInputArgs, buildRemuxArgs } from "./mux-ffmpeg-args";
import { postError, postResult, state, tryUnlink } from "./mux-state";
import { fetchThumbnail } from "./mux-thumbnail";
import type { TranscodeAudioJob, TranscodeFileJob } from "@/lib/download-pipeline/mux-worker-types";
import {
  audioContainers,
  getAudioFallbackCodec,
  getCompatibleFilename,
  getFileExtension
} from "@/lib/utils/containers";
import type { Prettify } from "@/types";

const FFMPEG_CODEC_COPY = "copy";
const FFMPEG_CODEC_MJPEG = "mjpeg";
const JPEG_EXTENSION = "jpg";
const COVER_FILENAME_PREFIX = "cover";

export function handleTranscodeAudio(job: TranscodeAudioJob) {
  const { audioData, sourceExtension, filenameOutput, videoId, tabId } = job;
  state.currentVideoId = videoId;
  state.currentTabId = tabId;
  const outputExtension = getFileExtension(filenameOutput) || sourceExtension;
  const inputFilename = `input.${sourceExtension}`;
  const outputFilename = getCompatibleFilename(filenameOutput);

  state.progressOffset = 0;
  state.progressScale = 1;

  state.ffmpeg!.FS.writeFile(inputFilename, new Uint8Array(audioData));

  try {
    const codec = getAudioFallbackCodec(outputExtension) ?? FFMPEG_CODEC_COPY;
    const exitCode = state.ffmpeg!.exec(...buildInputArgs(inputFilename), "-map", "0:a", "-c:a", codec, outputFilename);
    const isExecFailed = exitCode !== 0;
    if (isExecFailed) {
      postError(`FFmpeg transcode exited with code ${exitCode}`);
      return;
    }

    const output = state.ffmpeg!.FS.readFile(outputFilename, { encoding: "binary" });
    const isEmptyOutput = typeof output === "string" || output.byteLength === 0;
    if (isEmptyOutput) {
      postError("FFmpeg transcode produced empty output");
      return;
    }

    postResult(output);
  } finally {
    tryUnlink(inputFilename);
    tryUnlink(outputFilename);
  }
}

async function tryWriteCoverArt(coverArtUrl: string) {
  const thumbnail = await fetchThumbnail(coverArtUrl);
  if (!thumbnail) {
    return null;
  }

  const coverFilename = `${COVER_FILENAME_PREFIX}.${thumbnail.extension}`;
  state.ffmpeg!.FS.writeFile(coverFilename, thumbnail.data);
  return coverFilename;
}

type ExtractAudioWithCoverArtParams = Prettify<{
  sourceFilename: string;
  outputFilename: string;
  targetContainer: string;
  coverArtUrl: string;
}>;
async function extractAudioWithCoverArt({
  sourceFilename, outputFilename, targetContainer, coverArtUrl
}: ExtractAudioWithCoverArtParams) {
  const coverFilename = await tryWriteCoverArt(coverArtUrl);
  const audioCodec = getAudioFallbackCodec(targetContainer) ?? FFMPEG_CODEC_COPY;
  const ffmpegArgs = [...buildInputArgs(sourceFilename)];
  if (coverFilename) {
    ffmpegArgs.push(...buildInputArgs(coverFilename), "-map", "0:a", "-map", "1");
    ffmpegArgs.push("-c:v", coverFilename.endsWith(`.${JPEG_EXTENSION}`) ? FFMPEG_CODEC_COPY : FFMPEG_CODEC_MJPEG);
    ffmpegArgs.push("-disposition:v", "attached_pic");
  } else {
    ffmpegArgs.push("-map", "0:a");
  }

  ffmpegArgs.push("-c:a", audioCodec, outputFilename);
  return {
    args: ffmpegArgs,
    coverFilename
  };
}

export async function handleTranscodeFile(job: TranscodeFileJob) {
  const {
    videoId, tabId, data, sourceExtension, targetContainer, audioMimeType, videoMimeType, coverArtUrl
  } = job;
  state.currentVideoId = videoId;
  state.currentTabId = tabId;
  const sourceFilename = `source.${sourceExtension}`;
  const outputFilename = `output.${targetContainer}`;
  const isAudioTarget = audioContainers.includes(targetContainer);

  state.progressOffset = 0;
  state.progressScale = 1;

  state.ffmpeg!.FS.writeFile(sourceFilename, new Uint8Array(data));

  let coverFilenameForCleanup: string | null = null;
  try {
    const ffmpegArgs = isAudioTarget && coverArtUrl
      ? await (async () => {
        const result = await extractAudioWithCoverArt({
          sourceFilename,
          outputFilename,
          targetContainer,
          coverArtUrl
        });
        coverFilenameForCleanup = result.coverFilename;
        return result.args;
      })()
      : buildRemuxArgs({
        inputFilename: sourceFilename,
        outputFilename,
        targetExtension: targetContainer,
        audioMimeType,
        videoMimeType
      });

    const exitCode = state.ffmpeg!.exec(...ffmpegArgs);
    const isExecFailed = exitCode !== 0;
    if (isExecFailed) {
      postError(`FFmpeg exited with code ${exitCode}`);
      return;
    }

    const output = state.ffmpeg!.FS.readFile(outputFilename, { encoding: "binary" });
    const isStringOutput = typeof output === "string";
    if (isStringOutput) {
      postError("FFmpeg readFile returned unexpected string output");
      return;
    }

    postResult(output);
  } finally {
    tryUnlink(sourceFilename);
    tryUnlink(outputFilename);

    if (coverFilenameForCleanup) {
      tryUnlink(coverFilenameForCleanup);
    }
  }
}

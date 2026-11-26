import { required } from "@/lib/required";
import { prepareCoverArt } from "./mux-cover-art";
import { buildInputArgs, buildRemuxArgs } from "./mux-ffmpeg-args";
import { postError, postResult, state, tryUnlink } from "./mux-state";
import type { TranscodeAudioJob, TranscodeFileJob } from "@/lib/download-pipeline/mux-worker-types";
import {
  audioContainers,
  FFMPEG_CODEC_COPY,
  getAudioFallbackCodec,
  getCompatibleFilename,
  getFileExtension,
  resolveAudioCodec
} from "@/lib/utils/containers";
import type { Prettify } from "@/types";

export function handleTranscodeAudio(job: TranscodeAudioJob) {
  const { audioData, sourceExtension, filenameOutput, videoId, tabId } = job;
  state.currentVideoId = videoId;
  state.currentTabId = tabId;
  const outputExtension = getFileExtension(filenameOutput) || sourceExtension;
  const inputFilename = `input.${sourceExtension}`;
  const outputFilename = getCompatibleFilename(filenameOutput);

  state.progressOffset = 0;
  state.progressScale = 1;

  required(state.ffmpeg).FS.writeFile(inputFilename, new Uint8Array(audioData));

  try {
    const codec = getAudioFallbackCodec(outputExtension) ?? FFMPEG_CODEC_COPY;
    const exitCode = required(state.ffmpeg).exec(...buildInputArgs(inputFilename), "-map", "0:a", "-c:a", codec, outputFilename);
    const isExecFailed = exitCode !== 0;
    if (isExecFailed) {
      postError(`FFmpeg transcode exited with code ${exitCode}`);
      return;
    }

    const output = required(state.ffmpeg).FS.readFile(outputFilename, { encoding: "binary" });
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

type ExtractAudioWithCoverArtParams = Prettify<{
  sourceFilename: string;
  outputFilename: string;
  targetContainer: string;
  coverArtUrl: string;
  audioMimeType: string;
}>;
async function extractAudioWithCoverArt({
  sourceFilename, outputFilename, targetContainer, coverArtUrl, audioMimeType
}: ExtractAudioWithCoverArtParams) {
  const cover = await prepareCoverArt({
    thumbnailUrl: coverArtUrl,
    outputExtension: targetContainer
  });
  const audioCodec = resolveAudioCodec({
    audioMimeType,
    targetExtension: targetContainer
  });
  return {
    args: [
      ...buildInputArgs(sourceFilename), ...cover.inputArgs, "-map", "0:a", ...cover.outputArgs,
      "-c:a", audioCodec, outputFilename
    ],
    coverFilename: cover.filename
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

  required(state.ffmpeg).FS.writeFile(sourceFilename, new Uint8Array(data));

  let coverFilenameForCleanup: string | null = null;
  try {
    const ffmpegArgs = isAudioTarget && coverArtUrl
      ? await (async () => {
        const result = await extractAudioWithCoverArt({
          sourceFilename,
          outputFilename,
          targetContainer,
          coverArtUrl,
          audioMimeType: audioMimeType ?? ""
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

    const exitCode = required(state.ffmpeg).exec(...ffmpegArgs);
    const isExecFailed = exitCode !== 0;
    if (isExecFailed) {
      postError(`FFmpeg exited with code ${exitCode}`);
      return;
    }

    const output = required(state.ffmpeg).FS.readFile(outputFilename, { encoding: "binary" });
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

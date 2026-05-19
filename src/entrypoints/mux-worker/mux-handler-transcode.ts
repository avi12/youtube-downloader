import { buildRemuxArgs } from "./mux-ffmpeg-args";
import { postError, postResult, state, tryUnlink } from "./mux-state";
import type { TranscodeAudioJob, TranscodeFileJob } from "@/lib/download-pipeline/mux-worker-types";
import { getCompatibleFilename, getFileExtension } from "@/lib/utils/containers";

const AUDIO_CODEC_BY_EXTENSION: Record<string, string> = {
  flac: "flac",
  m4a: "aac",
  mp3: "libmp3lame",
  ogg: "libvorbis",
  opus: "libopus",
  webm: "libopus"
};

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
    const codec = AUDIO_CODEC_BY_EXTENSION[outputExtension] ?? "copy";
    const exitCode = state.ffmpeg!.exec("-i", inputFilename, "-map", "0:a", "-c:a", codec, outputFilename);
    if (exitCode !== 0) {
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

export function handleTranscodeFile(job: TranscodeFileJob) {
  const { videoId, tabId, data, sourceExtension, targetContainer, audioMimeType } = job;
  state.currentVideoId = videoId;
  state.currentTabId = tabId;
  const sourceFilename = `source.${sourceExtension}`;
  const outputFilename = `output.${targetContainer}`;

  state.progressOffset = 0;
  state.progressScale = 1;

  state.ffmpeg!.FS.writeFile(sourceFilename, new Uint8Array(data));

  try {
    const exitCode = state.ffmpeg!.exec(
      ...buildRemuxArgs({
        inputFilename: sourceFilename,
        outputFilename,
        targetExtension: targetContainer,
        audioMimeType
      })
    );
    if (exitCode !== 0) {
      postError(`FFmpeg exited with code ${exitCode}`);
      return;
    }

    const output = state.ffmpeg!.FS.readFile(outputFilename, { encoding: "binary" });
    if (typeof output === "string") {
      postError("FFmpeg readFile returned unexpected string output");
      return;
    }

    postResult(output);
  } finally {
    tryUnlink(sourceFilename);
    tryUnlink(outputFilename);
  }
}

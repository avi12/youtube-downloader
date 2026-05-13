import { buildMuxFfmpegArgs } from "./mux-args-builder";
import type { MuxFfmpegParams } from "./mux-args-builder";
import { buildRemuxArgs } from "./mux-codec-args";
import { postError, postResult, state } from "./mux-state";

export function executeMuxPhases(params: MuxFfmpegParams): boolean {
  const phase1Code = state.ffmpeg!.exec(...buildMuxFfmpegArgs(params));
  if (phase1Code !== 0) {
    postError(`FFmpeg phase 1 exited with code ${phase1Code}`);
    return false;
  }

  const { useIntermediateMkv, muxFilename, outputFilename, targetExtension, audioMimeType } = params;
  if (useIntermediateMkv) {
    state.progressOffset = 0.5;
    state.progressScale = 0.5;
    const phase2Code = state.ffmpeg!.exec(
      ...buildRemuxArgs({
        inputFilename: muxFilename,
        outputFilename,
        targetExtension,
        audioMimeType
      })
    );
    if (phase2Code !== 0) {
      postError(`FFmpeg phase 2 exited with code ${phase2Code}`);
      return false;
    }
  }

  const output = state.ffmpeg!.FS.readFile(outputFilename, { encoding: "binary" });
  if (typeof output === "string") {
    postError("FFmpeg readFile returned unexpected string output");
    return false;
  }

  postResult(output);
  return true;
}

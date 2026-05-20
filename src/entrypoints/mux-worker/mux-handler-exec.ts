import { buildMuxFfmpegArgs } from "./mux-ffmpeg-args";
import type { MuxFfmpegParams } from "./mux-ffmpeg-args";
import { buildRemuxArgs } from "./mux-ffmpeg-args";
import { postError, state } from "./mux-state";

type CheckOutput = (filename: string) => boolean;

export function tryCheckOutput(filename: string): boolean {
  try {
    const stat = state.ffmpeg!.FS.stat(filename);
    return stat.size > 0;
  } catch {
    return false;
  }
}

type ExecuteMuxPhasesParams = {
  params: MuxFfmpegParams;
  checkOutput: CheckOutput;
};
export function executeMuxPhases({ params, checkOutput }: ExecuteMuxPhasesParams): boolean {
  const { useIntermediateMkv, muxFilename, outputFilename, targetExtension, audioMimeType } = params;

  const phase1Code = state.ffmpeg!.exec(...buildMuxFfmpegArgs(params));
  if (phase1Code !== 0) {
    const phase1File = useIntermediateMkv ? muxFilename : outputFilename;
    if (!checkOutput(phase1File)) {
      postError(`FFmpeg phase 1 exited with code ${phase1Code}`);
      return false;
    }
  }

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
    const isPhase2Failed = phase2Code !== 0 && !checkOutput(outputFilename);
    if (isPhase2Failed) {
      postError(`FFmpeg phase 2 exited with code ${phase2Code}`);
      return false;
    }
  }

  if (!checkOutput(outputFilename)) {
    postError("FFmpeg output file is empty or missing");
    return false;
  }

  return true;
}

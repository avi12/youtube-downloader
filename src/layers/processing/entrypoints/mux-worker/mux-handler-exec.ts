import { required } from "@/lib/required";
import { buildMuxFfmpegArgs } from "./mux-ffmpeg-args";
import type { MuxFfmpegParams } from "./mux-ffmpeg-args";
import { buildRemuxArgs } from "./mux-ffmpeg-args";
import { postError, state } from "./mux-state";
import type { Prettify } from "@/types";

const HALF_PROGRESS = 0.5;

type CheckOutput = (filename: string) => boolean;

export function tryCheckOutput(filename: string) {
  try {
    const stat = required(state.ffmpeg).FS.stat(filename);
    return stat.size > 0;
  } catch {
    return false;
  }
}

type ExecuteMuxPhasesParams = Prettify<{
  params: MuxFfmpegParams;
  checkOutput: CheckOutput;
}>;
export function executeMuxPhases({ params, checkOutput }: ExecuteMuxPhasesParams) {
  const { useIntermediateMkv, muxFilename, outputFilename, targetExtension, audioMimeType } = params;

  const phase1Code = required(state.ffmpeg).exec(...buildMuxFfmpegArgs(params));
  const isPhase1Failed = phase1Code !== 0;
  if (isPhase1Failed) {
    const phase1File = useIntermediateMkv ? muxFilename : outputFilename;
    const isPhase1OutputMissing = !checkOutput(phase1File);
    if (isPhase1OutputMissing) {
      postError(`FFmpeg phase 1 exited with code ${phase1Code}`);
      return false;
    }
  }

  if (useIntermediateMkv) {
    state.progressOffset = HALF_PROGRESS;
    state.progressScale = HALF_PROGRESS;
    const phase2Code = required(state.ffmpeg).exec(
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

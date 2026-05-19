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

// Emscripten-compiled FFmpeg may call abort() during context cleanup even
// after a successful mux (e.g. WebVTT-in-MKV demuxer teardown). The output
// file is fully written before cleanup runs, so a non-zero exit code alone
// doesn't mean the mux failed - we check whether the file was actually written.
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
    if (phase2Code !== 0 && !checkOutput(outputFilename)) {
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

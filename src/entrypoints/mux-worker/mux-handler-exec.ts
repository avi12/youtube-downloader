import { buildMuxFfmpegArgs } from "./mux-args-builder";
import type { MuxFfmpegParams } from "./mux-args-builder";
import { buildRemuxArgs } from "./mux-codec-args";
import { postError, postResult, state } from "./mux-state";

// Emscripten-compiled FFmpeg may call abort() during context cleanup even
// after a successful mux (e.g. WebVTT-in-MKV demuxer teardown). The output
// file is fully written before cleanup runs, so a non-zero exit code alone
// doesn't mean the mux failed — we check whether the file was actually written.
function tryReadOutput(filename: string) {
  try {
    const result = state.ffmpeg!.FS.readFile(filename, { encoding: "binary" });
    return result instanceof Uint8Array && result.byteLength > 0 ? result : null;
  } catch {
    return null;
  }
}

export function executeMuxPhases(params: MuxFfmpegParams) {
  const { useIntermediateMkv, muxFilename, outputFilename, targetExtension, audioMimeType } = params;

  const phase1Code = state.ffmpeg!.exec(...buildMuxFfmpegArgs(params));
  if (phase1Code !== 0) {
    const phase1File = useIntermediateMkv ? muxFilename : outputFilename;
    if (!tryReadOutput(phase1File)) {
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
    if (phase2Code !== 0 && !tryReadOutput(outputFilename)) {
      postError(`FFmpeg phase 2 exited with code ${phase2Code}`);
      return false;
    }
  }

  const output = tryReadOutput(outputFilename);
  if (!output) {
    postError("FFmpeg output file is empty or missing");
    return false;
  }

  postResult(output);
  return true;
}

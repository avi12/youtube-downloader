import { getCompatibleFilename, getFileExtension } from "../containers";
import type { FFmpegCoreModule } from "@ffmpeg/types";

const audioCodecByExtension: Record<string, string> = {
  flac: "flac"
};

export async function transcodeAudio(
  audioData: Uint8Array,
  sourceExtension: string,
  filenameOutput: string,
  ffmpeg: FFmpegCoreModule
) {
  const outputExtension = getFileExtension(filenameOutput) || sourceExtension;
  const inputFilename = `input.${sourceExtension}`;
  const outputFilename = getCompatibleFilename(filenameOutput);

  ffmpeg.FS.writeFile(inputFilename, audioData);

  try {
    const codec = audioCodecByExtension[outputExtension] ?? "copy";
    const exitCode = ffmpeg.exec("-i", inputFilename, "-map", "0:a", "-c:a", codec, outputFilename);
    if (exitCode !== 0) {
      throw new Error(`FFmpeg transcode exited with code ${exitCode}`);
    }

    const output = ffmpeg.FS.readFile(outputFilename, { encoding: "binary" });
    if (typeof output === "string" || output.byteLength === 0) {
      throw new Error("FFmpeg transcode produced empty output");
    }

    return output;
  } finally {
    try {
      ffmpeg.FS.unlink(inputFilename);
    } catch { /* already removed */ }
    try {
      ffmpeg.FS.unlink(outputFilename);
    } catch { /* already removed */ }
  }
}

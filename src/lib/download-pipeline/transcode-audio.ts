import { getFFmpeg, tryUnlink } from "./ffmpeg-instance";
import { getCompatibleFilename, getFileExtension } from "@/lib/utils/containers";

const audioCodecByExtension: Record<string, string> = {
  flac: "flac"
};

export async function transcodeAudio({ audioData, sourceExtension, filenameOutput }: {
  audioData: Uint8Array;
  sourceExtension: string;
  filenameOutput: string;
}) {
  const ffmpeg = getFFmpeg();
  const outputExtension = getFileExtension(filenameOutput) || sourceExtension;
  const inputFilename = `input.${sourceExtension}`;
  const outputFilename = getCompatibleFilename(filenameOutput);

  await ffmpeg.FS.writeFile(inputFilename, audioData);

  try {
    const codec = audioCodecByExtension[outputExtension] ?? "copy";
    const exitCode = await ffmpeg.exec("-i", inputFilename, "-map", "0:a", "-c:a", codec, outputFilename);
    if (exitCode !== 0) {
      throw new Error(`FFmpeg transcode exited with code ${exitCode}`);
    }

    const output = await ffmpeg.FS.readFile(outputFilename);
    if (output.byteLength === 0) {
      throw new Error("FFmpeg transcode produced empty output");
    }

    return output;
  } finally {
    tryUnlink(inputFilename);
    tryUnlink(outputFilename);
  }
}

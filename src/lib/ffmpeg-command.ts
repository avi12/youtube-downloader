import { tokenize } from "@/lib/command";
import type { Job } from "@/lib/ytdlp/plan";

const FFMPEG_PROGRAM = "ffmpeg";
const INPUT_PLACEHOLDER_PATTERN = /\{input(\d+)\}/g;
const EXTENSION_PATTERN = /\.[^./\\]+$/;

function resolvePlaceholders(arg: string, job: Job) {
  return arg.replace(INPUT_PLACEHOLDER_PATTERN, (_match, position: string) => {
    const input = job.inputs[Number(position) - 1];
    if (!input) {
      throw new Error(`{input${position}} doesn't exist, this download has ${job.inputs.length} stream(s)`);
    }

    return input.name;
  });
}

export function applyFfmpegCommand(job: Job, command: string): Job {
  const tokens = tokenize(command);
  const args = (tokens[0] === FFMPEG_PROGRAM ? tokens.slice(1) : tokens).map(arg => resolvePlaceholders(arg, job));
  const outputFile = args.at(-1);
  const outputExtension = outputFile?.match(EXTENSION_PATTERN)?.[0];
  const isInputName = job.inputs.some(input => input.name === outputFile);
  if (!outputFile || !outputExtension || isInputName) {
    throw new Error("End the FFmpeg command with an output file name, like snapshot.png");
  }

  return { ...job, args, outputFile, saveAs: job.saveAs.replace(EXTENSION_PATTERN, "") + outputExtension };
}

import { tokenize } from "@/lib/command";
import type { Job } from "@/lib/ytdlp/plan";

const FFMPEG_PROGRAM = "ffmpeg";
const INPUT_PLACEHOLDER_PATTERN = /\{input(\d+)\}/g;
const EXTENSION_PATTERN = /\.[^./\\]+$/;
const SEQUENCE_PATTERN = /%0?\d*d/;
const REGEX_SPECIALS_PATTERN = /[.*+?^${}()|[\]\\]/g;

type PlaceholderRequest = {
  arg: string;
  job: Job;
};
type FfmpegRequest = {
  job: Job;
  command: string;
};
type OutputLookup<File> = {
  files: File[];
  job: Job;
};

function resolvePlaceholders({ arg, job }: PlaceholderRequest) {
  return arg.replace(INPUT_PLACEHOLDER_PATTERN, (_match, position: string) => {
    const input = job.inputs[Number(position) - 1];
    if (!input) {
      throw new Error(`{input${position}} doesn't exist, this download has ${job.inputs.length} stream(s)`);
    }

    return input.name;
  });
}

export function applyFfmpegCommand({ job, command }: FfmpegRequest): Job {
  const tokens = tokenize(command);
  const args = (tokens[0] === FFMPEG_PROGRAM ? tokens.slice(1) : tokens).map(arg => resolvePlaceholders({
    arg,
    job
  }));
  const outputFile = args.at(-1);
  const outputExtension = outputFile?.match(EXTENSION_PATTERN)?.[0];
  const isInputName = job.inputs.some(input => input.name === outputFile);
  if (!outputFile || !outputExtension || isInputName) {
    throw new Error("End the FFmpeg command with an output file name, like snapshot.png");
  }

  return {
    ...job,
    args,
    outputFile,
    saveAs: job.saveAs.replace(EXTENSION_PATTERN, "") + outputExtension
  };
}

function escapeRegex(text: string) {
  return text.replace(REGEX_SPECIALS_PATTERN, String.raw`\$&`);
}

function buildSequencePattern(outputFile: string) {
  const [before = "", after = ""] = outputFile.split(SEQUENCE_PATTERN);
  return new RegExp(`^${escapeRegex(before)}\\d+${escapeRegex(after)}$`);
}

export function findJobOutputs<File extends { name: string }>({ files, job }: OutputLookup<File>) {
  if (!SEQUENCE_PATTERN.test(job.outputFile)) {
    return files.filter(file => file.name === job.outputFile).map(file => ({
      ...file,
      saveAs: job.saveAs
    }));
  }

  const pattern = buildSequencePattern(job.outputFile);
  const stem = job.saveAs.replace(EXTENSION_PATTERN, "");
  return files
    .filter(file => pattern.test(file.name))
    .sort((first, second) => first.name.localeCompare(second.name, undefined, { numeric: true }))
    .map(file => ({
      ...file,
      saveAs: `${stem} ${file.name}`
    }));
}

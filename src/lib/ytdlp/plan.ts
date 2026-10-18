import type { WorkerInput } from "@/entrypoints/ffmpeg-worker";
import type { ResolvedVideo } from "@/lib/youtube";
import type { YtDlpOptions } from "./options";
import { describeFormat, selectFormats } from "./selector";
import type { FormatFields } from "./selector";

const DEFAULT_FORMAT = "bv*+ba/b";
const DEFAULT_AUDIO_ONLY_FORMAT = "ba/b";
const DEFAULT_MP3_QUALITY = "5";
const ILLEGAL_FILENAME_PATTERN = /[\\/:*?"<>|\u0000-\u001f]/g;
const LEADING_DOTS_PATTERN = /^\.+/;
const TEMPLATE_FIELD_PATTERN = /%\((\w+)\)[sd]|%%/g;
const BITRATE_QUALITY_PATTERN = /k$/i;
const MISSING_FIELD = "NA";
const MP4_FAMILY = new Set(["mp4", "m4a"]);
const WEBM = "webm";
const MKV = "mkv";
const MP4 = "mp4";
const BEST_AUDIO_FORMAT = "best";

const AUDIO_ENCODERS: Record<string, string[]> = {
  mp3: ["libmp3lame"],
  m4a: ["aac"],
  aac: ["aac"],
  opus: ["libopus"],
  vorbis: ["libvorbis"],
  flac: ["flac"],
  wav: ["pcm_s16le"],
  alac: ["alac"]
};

export type Job = {
  label: string;
  inputs: WorkerInput[];
  args: string[];
};

export type Plan = {
  jobs: Job[];
  notes: string[];
};

function sanitizeFilename(name: string) {
  return name.replace(ILLEGAL_FILENAME_PATTERN, "_").replace(LEADING_DOTS_PATTERN, "").trim();
}

function renderTemplate(template: string, fields: Record<string, string | number | undefined>) {
  return template.replace(TEMPLATE_FIELD_PATTERN, (match, name?: string) => {
    if (!name) {
      return "%";
    }

    return String(fields[name] ?? MISSING_FIELD);
  });
}

function toWorkerInput(fields: FormatFields): WorkerInput {
  return {
    name: `format-${fields.format_id}.${fields.ext}`,
    url: fields.format.url,
    contentLength: Number(fields.format.contentLength) || undefined
  };
}

function pickContainer(options: YtDlpOptions, picks: FormatFields[]) {
  if (options.mergeOutputFormat) {
    return options.mergeOutputFormat;
  }

  if (options.recodeVideo) {
    return options.recodeVideo;
  }

  const extensions = picks.map(fields => fields.ext);
  if (extensions.every(extension => MP4_FAMILY.has(extension))) {
    return picks.some(fields => fields.hasVideo) ? MP4 : "m4a";
  }

  return extensions.every(extension => extension === WEBM) ? WEBM : MKV;
}

function buildSectionArgs(options: YtDlpOptions) {
  const { start, end } = options.section ?? {};
  return [...(start === undefined ? [] : ["-ss", String(start)]), ...(end === undefined ? [] : ["-to", String(end)])];
}

function buildInputArgs(options: YtDlpOptions, inputs: WorkerInput[]) {
  const sectionArgs = buildSectionArgs(options);
  return inputs.flatMap(input => [...sectionArgs, "-i", input.name]);
}

function buildAudioCodecArgs(options: YtDlpOptions, source: FormatFields) {
  const encoders = AUDIO_ENCODERS[options.audioFormat];
  if (options.audioFormat === BEST_AUDIO_FORMAT || !encoders) {
    return ["-c:a", "copy"];
  }

  const isSameCodec = source.ext === options.audioFormat || source.acodec.startsWith(options.audioFormat);
  if (isSameCodec) {
    return ["-c:a", "copy"];
  }

  const quality = options.audioQuality ?? DEFAULT_MP3_QUALITY;
  const isBitrate = BITRATE_QUALITY_PATTERN.test(quality);
  if (isBitrate) {
    return ["-c:a", ...encoders, "-b:a", quality];
  }

  return ["-c:a", ...encoders, ...(options.audioFormat === "mp3" ? ["-q:a", quality] : [])];
}

function buildMediaJob(options: YtDlpOptions, video: ResolvedVideo): Job {
  const defaultFormat = options.isExtractAudio ? DEFAULT_AUDIO_ONLY_FORMAT : DEFAULT_FORMAT;
  const picks = selectFormats(options.format ?? defaultFormat, video.formats, options.formatSort);
  const baseFields = { id: video.id, title: video.title, uploader: video.uploader, channel: video.uploader };
  const primary = picks.find(fields => fields.hasVideo) ?? picks[0]!;
  const labelFields = { ...baseFields, height: primary.height, width: primary.width, fps: primary.fps, format_id: picks.map(fields => fields.format_id).join("+") };

  if (options.isExtractAudio) {
    const source = picks.find(fields => fields.hasAudio);
    if (!source) {
      throw new Error("The selected format has no audio to extract");
    }

    const extension = options.audioFormat === BEST_AUDIO_FORMAT ? source.ext : options.audioFormat;
    const input = toWorkerInput(source);
    const name = sanitizeFilename(renderTemplate(options.output, { ...labelFields, ext: extension }));
    return {
      label: name,
      inputs: [input],
      args: [...buildInputArgs(options, [input]), "-vn", ...buildAudioCodecArgs(options, source), name]
    };
  }

  const inputs = picks.map(toWorkerInput);
  const extension = pickContainer(options, picks);
  const name = sanitizeFilename(renderTemplate(options.output, { ...labelFields, ext: extension }));
  const codecArgs = options.recodeVideo ? [] : ["-c", "copy"];
  return {
    label: name,
    inputs,
    args: [...buildInputArgs(options, inputs), ...codecArgs, name]
  };
}

function matchesLanguageList(languageCode: string, patterns: string[]) {
  const isIncluded = patterns.some(pattern => !pattern.startsWith("-") && (pattern === "all" || new RegExp(`^(?:${pattern})$`).test(languageCode)));
  const isExcluded = patterns.some(pattern => pattern.startsWith("-") && new RegExp(`^(?:${pattern.slice(1)})$`).test(languageCode));
  return isIncluded && !isExcluded;
}

function buildCaptionJobs(options: YtDlpOptions, video: ResolvedVideo): Job[] {
  const wantsManual = options.isWriteSubs;
  const wantsAuto = options.isWriteAutoSubs;
  if (!wantsManual && !wantsAuto) {
    return [];
  }

  const tracks = video.captions.filter(track => (track.isAutoGenerated ? wantsAuto : wantsManual) && matchesLanguageList(track.languageCode, options.subLangs));
  if (!tracks.length) {
    throw new Error("No captions match --sub-langs");
  }

  return tracks.map(track => {
    const fields = { id: video.id, title: video.title, uploader: video.uploader, channel: video.uploader, ext: options.subFormat };
    const stem = sanitizeFilename(renderTemplate(options.output, fields)).replace(new RegExp(`\\.${options.subFormat}$`), "");
    const name = `${stem}.${track.languageCode}.${options.subFormat}`;
    const input = { name: `captions-${track.languageCode}.vtt`, url: track.url };
    return { label: name, inputs: [input], args: ["-i", input.name, name] };
  });
}

function listFormats(video: ResolvedVideo) {
  const rows = video.formats.map(format => {
    const fields = describeFormat(format);
    const resolution = fields.hasVideo ? `${fields.width ?? "?"}x${fields.height ?? "?"}` : "audio only";
    const size = fields.filesize ? `${Math.round(fields.filesize / 1024 / 1024 * 10) / 10}MiB` : "~";
    return [fields.format_id, fields.ext, resolution, fields.fps ?? "", size, `${Math.round(fields.tbr)}k`, fields.vcodec, fields.acodec, fields.language ?? ""].join("\t");
  });
  return ["ID\tEXT\tRESOLUTION\tFPS\tSIZE\tTBR\tVCODEC\tACODEC\tLANG", ...rows];
}

export function planJobs(options: YtDlpOptions, video: ResolvedVideo): Plan {
  if (options.isListFormats) {
    return { jobs: [], notes: listFormats(video) };
  }

  const captionJobs = buildCaptionJobs(options, video);
  const isMediaWanted = !options.isSkipDownload;
  if (!isMediaWanted && !captionJobs.length) {
    throw new Error("Nothing to do: add --write-subs or drop --skip-download");
  }

  return { jobs: [...(isMediaWanted ? [buildMediaJob(options, video)] : []), ...captionJobs], notes: [] };
}

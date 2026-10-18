import type { WorkerInput } from "@/entrypoints/ffmpeg-worker";
import type { Thumbnail } from "@/lib/schemas";
import type { CaptionOption, ResolvedVideo } from "@/lib/youtube";
import {
  applyMetadataRules,
  buildFormatFields,
  buildSavePath,
  buildSectionFields,
  buildVideoFields,
  formatByteSize
} from "./fields";
import type { Chapter, PlaylistPosition, SectionContext } from "./fields";
import { matchesAnyFilter, parseByteSize, parseDateSpec } from "./filters";
import type { AudioFormat, Section, YtDlpOptions } from "./options";
import { DEFAULT_SORT_KEYS, describeFormat, selectFormatSets } from "./selector";
import type { FormatFields } from "./selector";
import { renderTemplate } from "./template";
import type { TemplateFields } from "./template";

const DEFAULT_FORMAT = "bv*+ba/b";
const DEFAULT_AUDIO_ONLY_FORMAT = "ba/b";
const DEFAULT_MP3_QUALITY = "5";
const BITRATE_QUALITY_PATTERN = /k$/i;
const MP4_FAMILY = new Set(["mp4", "m4a", "mov"]);
const WEBM = "webm";
const MKV = "mkv";
const MP4 = "mp4";
const BEST_AUDIO_FORMAT = "best";
const DEFAULT_OUTPUT_KEY = "default";
const SECTION_DEFAULT_TEMPLATE = "%(title)s [%(id)s] [%(section_start)d-%(section_end)d].%(ext)s";
const CHAPTER_DEFAULT_TEMPLATE = "%(title)s - %(section_number)03d %(section_title)s [%(id)s].%(ext)s";
const THUMBNAIL_INPUT = "thumbnail.jpg";
const CHAPTERS_INPUT = "chapters.txt";
const OUTPUT_BASENAME = "output";
const MILLISECONDS_PER_SECOND = 1000;
const JPEG_PATTERN = /\.jpe?g(?:\?|$)/;
const THUMBNAIL_EMBED_FORMATS = new Set(["mp4", "m4a", "mp3", "mov", "mkv", "webm"]);
const MATROSKA_FORMATS = new Set(["mkv", "webm"]);
const BASE_PROCESSORS = ["ffmpeg", "ffmpeg_o"];
const MEDIA_PROCESSORS = ["merger", "videoconvertor", "videoremuxer", "extractaudio", "metadata", "embedsubtitle", "embedthumbnail", "fixupm4a", "fixupstretched"];

const AUDIO_ENCODERS: Record<Exclude<AudioFormat, "best">, string[]> = {
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
  outputFile: string;
  saveAs: string;
  isMedia?: boolean;
};

export type DirectFile = { saveAs: string; text?: string; url?: string };

export type VideoContext = {
  video: ResolvedVideo;
  chapters: Chapter[];
  playlist?: PlaylistPosition;
  autonumber: number;
  now?: Date;
};

export type VideoPlan = {
  jobs: Job[];
  directFiles: DirectFile[];
  printed: string[];
  skipReason?: string;
  isBreak?: boolean;
};

type MediaInput = { worker: WorkerInput; before: string[] };

function selectAudioCodecArgs(options: YtDlpOptions, source: FormatFields) {
  const isSameCodec = source.ext === options.audioFormat || source.acodec.startsWith(options.audioFormat);
  if (options.audioFormat === BEST_AUDIO_FORMAT || isSameCodec) {
    return ["-c:a", "copy"];
  }

  const encoders = AUDIO_ENCODERS[options.audioFormat];
  const quality = options.audioQuality ?? DEFAULT_MP3_QUALITY;
  if (BITRATE_QUALITY_PATTERN.test(quality)) {
    return ["-c:a", ...encoders, "-b:a", quality];
  }

  return ["-c:a", ...encoders, ...(options.audioFormat === "mp3" ? ["-q:a", quality] : [])];
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

function pickSubtitleCodec(container: string) {
  if (container === WEBM) {
    return "webvtt";
  }

  return MATROSKA_FORMATS.has(container) ? "srt" : "mov_text";
}

function selectProcessorArgs(options: YtDlpOptions, names: string[]) {
  return names.flatMap(name => options.postprocessorArgs[name] ?? []);
}

function buildSectionArgs(section?: SectionContext) {
  const { start, end } = section ?? {};
  return [...(start === undefined ? [] : ["-ss", String(start)]), ...(end === undefined ? [] : ["-to", String(end)])];
}

function pickBestJpeg(thumbnails: Thumbnail[]) {
  return thumbnails.findLast(thumbnail => JPEG_PATTERN.test(thumbnail.url)) ?? thumbnails.at(-1);
}

function matchesLanguageList(languageCode: string, patterns: string[]) {
  const isIncluded = patterns.some(pattern => !pattern.startsWith("-") && (pattern === "all" || new RegExp(`^(?:${pattern})$`).test(languageCode)));
  const isExcluded = patterns.some(pattern => pattern.startsWith("-") && new RegExp(`^(?:${pattern.slice(1)})$`).test(languageCode));
  return isIncluded && !isExcluded;
}

function selectCaptionTracks(options: YtDlpOptions, video: ResolvedVideo) {
  const wantsManual = options.isWriteSubs || options.isEmbedSubs;
  const wantsAuto = options.isWriteAutoSubs;
  return video.captions.filter(track => (track.isAutoGenerated ? wantsAuto : wantsManual) && matchesLanguageList(track.languageCode, options.subLangs));
}

function buildChaptersText(chapters: Chapter[], title: string) {
  const blocks = chapters.map(chapter => `[CHAPTER]\nTIMEBASE=1/${MILLISECONDS_PER_SECOND}\nSTART=${Math.round(chapter.start * MILLISECONDS_PER_SECOND)}\nEND=${Math.round(chapter.end * MILLISECONDS_PER_SECOND)}\ntitle=${chapter.title}`);
  return [";FFMETADATA1", `title=${title}`, ...blocks].join("\n");
}

function resolveSections(options: YtDlpOptions, chapters: Chapter[]): (Section & { title?: string })[] {
  return options.sections.flatMap(section => {
    if (!section.chapterPattern) {
      return [section];
    }

    if (!chapters.length) {
      throw new Error("This video has no chapters, so --download-sections with a chapter pattern can't match");
    }

    const pattern = new RegExp(section.chapterPattern);
    return chapters.filter(chapter => pattern.test(chapter.title)).map(chapter => ({ start: chapter.start, end: chapter.end, title: chapter.title }));
  });
}

function buildMetadataArgs(fields: TemplateFields) {
  const entries: [string, TemplateFields[string]][] = [
    ["title", fields.title],
    ["artist", fields.uploader],
    ["date", fields.upload_date],
    ["description", fields.description],
    ["comment", fields.webpage_url]
  ];
  return entries.flatMap(([key, value]) => (value ? ["-metadata", `${key}=${value}`] : []));
}

function resolveTemplateKey(options: YtDlpOptions, section: SectionContext | undefined, isChapterSplit: boolean) {
  if (isChapterSplit) {
    return { key: "chapter", fallback: CHAPTER_DEFAULT_TEMPLATE };
  }

  if (section?.start !== undefined || section?.end !== undefined) {
    return { key: DEFAULT_OUTPUT_KEY, fallback: SECTION_DEFAULT_TEMPLATE };
  }

  return { key: DEFAULT_OUTPUT_KEY, fallback: options.outputs.default! };
}

type MediaContext = {
  options: YtDlpOptions;
  context: VideoContext;
  fields: TemplateFields;
  picks: FormatFields[];
  tracks: CaptionOption[];
  notes: string[];
};

function buildMediaJob({ options, context, fields, picks, tracks, notes }: MediaContext, section: SectionContext | undefined, isChapterSplit: boolean): Job {
  const { video, chapters } = context;
  const sectionArgs = buildSectionArgs(section);
  const primary = picks.find(pick => pick.hasVideo) ?? picks[0]!;
  const inputs: MediaInput[] = [];
  const extraArgs: string[] = [];
  let container: string;
  let codecArgs: string[];

  if (options.isExtractAudio) {
    const source = picks.find(pick => pick.hasAudio);
    if (!source) {
      throw new Error("The selected format has no audio to extract");
    }

    container = pickAudioContainer(options, picks);
    inputs.push({ worker: toWorkerInput(source), before: sectionArgs });
    codecArgs = selectAudioCodecArgs(options, source);
  } else {
    container = pickContainer(options, picks);
    inputs.push(...picks.map(pick => ({ worker: toWorkerInput(pick), before: sectionArgs })));
    const isRecoding = Boolean(options.recodeVideo) || (options.isForceKeyframes && sectionArgs.length > 0);
    codecArgs = isRecoding ? [] : ["-c", "copy"];
  }

  const mediaInputCount = inputs.length;
  const isMatroska = MATROSKA_FORMATS.has(container);
  const canEmbedSubs = options.isEmbedSubs && !options.isExtractAudio && (isMatroska || MP4_FAMILY.has(container));
  if (options.isEmbedSubs && !canEmbedSubs) {
    notes.push(`Can't embed subtitles in .${container}, skipped`);
  }

  const embeddedTracks = canEmbedSubs ? tracks : [];
  const subtitleCodec = pickSubtitleCodec(container);
  for (const track of embeddedTracks) {
    inputs.push({ worker: { name: `embed-${track.languageCode}.vtt`, url: track.url }, before: sectionArgs });
  }

  const thumbnail = options.isEmbedThumbnail ? pickBestJpeg(video.thumbnails) : undefined;
  const canEmbedThumbnail = Boolean(thumbnail) && THUMBNAIL_EMBED_FORMATS.has(container);
  if (options.isEmbedThumbnail && !canEmbedThumbnail) {
    notes.push(`Can't embed a thumbnail in .${container}, skipped`);
  }

  const thumbnailIndex = inputs.length;
  if (canEmbedThumbnail && !isMatroska) {
    inputs.push({ worker: { name: THUMBNAIL_INPUT, url: thumbnail!.url }, before: [] });
  }

  const chapterIndex = inputs.length;
  const shouldEmbedChapters = options.isEmbedChapters && chapters.length > 0 && !section;
  if (shouldEmbedChapters) {
    inputs.push({ worker: { name: CHAPTERS_INPUT, text: buildChaptersText(chapters, video.title) }, before: ["-f", "ffmetadata"] });
  }

  const hasExtraStreams = inputs.length > mediaInputCount;
  const isAttachingAudioCover = options.isExtractAudio && canEmbedThumbnail && !isMatroska;
  const streamInputs = inputs.slice(0, mediaInputCount + embeddedTracks.length);
  const mapArgs = isAttachingAudioCover ? ["-map", "0:a"] : streamInputs.flatMap((_, index) => (hasExtraStreams ? ["-map", String(index)] : []));
  if (options.isExtractAudio && !isAttachingAudioCover) {
    codecArgs.unshift("-vn");
  }

  const subtitleArgs = embeddedTracks.flatMap((track, index) => ["-metadata:s:s:" + index, `language=${track.languageCode}`]);
  extraArgs.push(...mapArgs, ...(embeddedTracks.length ? ["-c:s", subtitleCodec, ...subtitleArgs] : []));

  if (canEmbedThumbnail && !isMatroska) {
    const videoStreamCount = options.isExtractAudio ? 0 : picks.filter(pick => pick.hasVideo).length;
    const coverArgs = isAttachingAudioCover ? ["-c:v", "copy", ...(container === "mp3" ? ["-id3v2_version", "3"] : [])] : [];
    extraArgs.push("-map", String(thumbnailIndex), ...coverArgs, `-disposition:v:${videoStreamCount}`, "attached_pic");
  }

  if (canEmbedThumbnail && isMatroska) {
    extraArgs.push("-attach", THUMBNAIL_INPUT, "-metadata:s:t", "mimetype=image/jpeg");
    inputs.push({ worker: { name: THUMBNAIL_INPUT, url: thumbnail!.url }, before: [] });
  }

  if (shouldEmbedChapters) {
    extraArgs.push("-map_chapters", String(chapterIndex));
  }

  const processorNames = [...BASE_PROCESSORS, ...MEDIA_PROCESSORS];
  const inputArgs = selectProcessorArgs(options, ["ffmpeg_i"]);
  const inputTokens = inputs.flatMap(({ worker, before }) => {
    const isStreamInput = worker.name !== THUMBNAIL_INPUT || !isMatroska;
    return isStreamInput ? [...inputArgs, ...before, "-i", worker.name] : [];
  });
  const outputFile = `${OUTPUT_BASENAME}.${container}`;
  const metadataArgs = options.isEmbedMetadata ? buildMetadataArgs(fields) : [];
  const { key, fallback } = resolveTemplateKey(options, section, isChapterSplit);
  const templateOptions = { ...options, outputs: { ...options.outputs, [key]: options.outputs[key] ?? fallback } };
  const saveAs = buildSavePath(templateOptions, key, { ...fields, ...buildSectionFields(section), height: primary.height }, container);
  return {
    label: saveAs,
    inputs: inputs.map(({ worker }) => worker),
    args: [...inputTokens, ...codecArgs, ...extraArgs, ...metadataArgs, ...selectProcessorArgs(options, processorNames), outputFile],
    outputFile,
    saveAs,
    isMedia: true
  };
}

function buildCompanionFiles(options: YtDlpOptions, context: VideoContext, fields: TemplateFields, tracks: CaptionOption[]) {
  const { video } = context;
  const jobs: Job[] = [];
  const directFiles: DirectFile[] = [];
  const subtitlePostArgs = selectProcessorArgs(options, ["ffmpeg", "ffmpeg_o", "subtitlesconvertor"]);
  const shouldWriteSubs = options.isWriteSubs || options.isWriteAutoSubs;
  for (const track of shouldWriteSubs ? tracks : []) {
    const saveAs = buildSavePath(options, "subtitle", fields, `${track.languageCode}.${options.subFormat}`);
    if (options.subFormat === "vtt") {
      directFiles.push({ saveAs, url: track.url });
      continue;
    }

    const input = { name: `captions-${track.languageCode}.vtt`, url: track.url };
    const outputFile = `${OUTPUT_BASENAME}.${options.subFormat}`;
    jobs.push({ label: saveAs, inputs: [input], args: ["-i", input.name, ...subtitlePostArgs, outputFile], outputFile, saveAs });
  }

  const thumbnails = options.isWriteAllThumbnails ? video.thumbnails.filter(thumbnail => JPEG_PATTERN.test(thumbnail.url)) : [pickBestJpeg(video.thumbnails)];
  const shouldWriteThumbnails = options.isWriteThumbnail || options.isWriteAllThumbnails;
  const thumbnailTargetExtension = options.convertThumbnails ?? "jpg";
  for (const [index, thumbnail] of (shouldWriteThumbnails ? thumbnails : []).entries()) {
    if (!thumbnail) {
      continue;
    }

    const suffix = options.isWriteAllThumbnails ? `${index}.` : "";
    const saveAs = buildSavePath(options, "thumbnail", fields, `${suffix}${thumbnailTargetExtension}`);
    if (thumbnailTargetExtension === "jpg" || thumbnailTargetExtension === "jpeg") {
      directFiles.push({ saveAs, url: thumbnail.url });
      continue;
    }

    const input = { name: THUMBNAIL_INPUT, url: thumbnail.url };
    const outputFile = `${OUTPUT_BASENAME}.${thumbnailTargetExtension}`;
    const thumbnailArgs = selectProcessorArgs(options, ["ffmpeg", "ffmpeg_o", "thumbnailsconvertor"]);
    jobs.push({ label: saveAs, inputs: [input], args: ["-i", input.name, ...thumbnailArgs, outputFile], outputFile, saveAs });
  }

  if (options.isWriteDescription) {
    directFiles.push({ saveAs: buildSavePath(options, "description", fields, "description"), text: video.description });
  }

  if (options.isWriteInfoJson) {
    directFiles.push({ saveAs: buildSavePath(options, "infojson", fields, "info.json"), text: JSON.stringify(buildInfoObject(fields, video), null, 2) });
  }

  const url = String(fields.webpage_url);
  const linkTemplates: Record<string, string> = {
    url: `[InternetShortcut]\nURL=${url}\n`,
    webloc: `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n<key>URL</key>\n<string>${url}</string>\n</dict>\n</plist>\n`,
    desktop: `[Desktop Entry]\nEncoding=UTF-8\nName=${video.title}\nType=Link\nURL=${url}\nIcon=text-html\n`
  };
  for (const kind of options.linkKinds) {
    directFiles.push({ saveAs: buildSavePath(options, "link", fields, kind), text: linkTemplates[kind] });
  }

  return { jobs, directFiles };
}

function buildInfoObject(fields: TemplateFields, video: ResolvedVideo) {
  return {
    ...fields,
    formats: video.formats.map(format => {
      const described = describeFormat(format);
      return { format_id: described.format_id, ext: described.ext, resolution: described.resolution, fps: described.fps, vcodec: described.vcodec, acodec: described.acodec, tbr: described.tbr, filesize: described.filesize, language: described.language, url: format.url };
    }),
    subtitles: Object.fromEntries(video.captions.filter(track => !track.isAutoGenerated).map(track => [track.languageCode, [{ ext: "vtt", url: track.url, name: track.label }]])),
    automatic_captions: Object.fromEntries(video.captions.filter(track => track.isAutoGenerated).map(track => [track.languageCode, [{ ext: "vtt", url: track.url, name: track.label }]])),
    thumbnails: video.thumbnails
  };
}

function formatTable(rows: (string | number | undefined)[][]) {
  return rows.map(row => row.map(cell => cell ?? "").join("\t"));
}

function listFormats(video: ResolvedVideo) {
  const rows = video.formats.map(format => {
    const fields = describeFormat(format);
    const size = fields.filesize ? formatByteSize(fields.filesize) : "~";
    return [fields.format_id, fields.ext, fields.resolution, fields.fps, size, `${Math.round(fields.tbr)}k`, fields.vcodec, fields.acodec, fields.language];
  });
  return formatTable([["ID", "EXT", "RESOLUTION", "FPS", "SIZE", "TBR", "VCODEC", "ACODEC", "LANG"], ...rows]);
}

function listSubs(video: ResolvedVideo) {
  return formatTable([["LANGUAGE", "NAME", "KIND"], ...video.captions.map(track => [track.languageCode, track.label, track.isAutoGenerated ? "automatic" : "manual"])]);
}

function listThumbnails(video: ResolvedVideo) {
  return formatTable([["ID", "WIDTH", "HEIGHT", "URL"], ...video.thumbnails.map((thumbnail, index) => [index, thumbnail.width, thumbnail.height, thumbnail.url])]);
}

function rejectionReason(options: YtDlpOptions, fields: TemplateFields, now: Date) {
  const uploadDate = typeof fields.upload_date === "string" ? fields.upload_date : undefined;
  const views = typeof fields.view_count === "number" ? fields.view_count : undefined;
  const checks: [boolean, string][] = [
    [!matchesAnyFilter(fields, options.matchFilters), "doesn't match --match-filters"],
    [Boolean(options.dateExact && uploadDate !== parseDateSpec(options.dateExact, now)), "isn't from the --date day"],
    [Boolean(options.dateBefore && uploadDate && uploadDate > parseDateSpec(options.dateBefore, now)), "is newer than --datebefore"],
    [Boolean(options.dateAfter && uploadDate && uploadDate < parseDateSpec(options.dateAfter, now)), "is older than --dateafter"],
    [options.minViews !== undefined && views !== undefined && views < options.minViews, "has fewer views than --min-views"],
    [options.maxViews !== undefined && views !== undefined && views > options.maxViews, "has more views than --max-views"]
  ];
  return checks.find(([isRejected]) => isRejected)?.[1];
}

function sizeRejection(options: YtDlpOptions, picks: FormatFields[]) {
  const total = picks.reduce((sum, pick) => sum + (pick.filesize ?? 0), 0);
  if (!total) {
    return undefined;
  }

  if (options.minFilesize && total < parseByteSize(options.minFilesize)) {
    return "is smaller than --min-filesize";
  }

  return options.maxFilesize && total > parseByteSize(options.maxFilesize) ? "is larger than --max-filesize" : undefined;
}

function isSimulation(options: YtDlpOptions) {
  const impliesSimulation = options.prints.length > 0 || options.isDumpJson || options.isListFormats || options.isListSubs || options.isListThumbnails;
  return options.isSimulate || (impliesSimulation && !options.isNoSimulate);
}

function buildPrintLines(options: YtDlpOptions, fields: TemplateFields, video: ResolvedVideo) {
  const dumped = options.isDumpJson ? [JSON.stringify(buildInfoObject(fields, video))] : [];
  return [...dumped, ...options.prints.map(template => renderTemplate(template, fields))];
}

export function planVideo(options: YtDlpOptions, context: VideoContext): VideoPlan {
  const { video } = context;
  const now = context.now ?? new Date();
  const fields = buildVideoFields(video, context.playlist, context.autonumber);
  applyMetadataRules(fields, options);
  const printed: string[] = [];
  const rejection = rejectionReason(options, fields, now);
  if (rejection) {
    return { jobs: [], directFiles: [], printed, skipReason: `"${video.title}" ${rejection}`, isBreak: options.isBreakOnReject };
  }

  if (options.isListFormats) {
    printed.push(...listFormats(video));
  }

  if (options.isListSubs) {
    printed.push(...listSubs(video));
  }

  if (options.isListThumbnails) {
    printed.push(...listThumbnails(video));
  }

  const sortKeys = options.isPreferFree ? ["free", ...(options.formatSort.length ? options.formatSort : DEFAULT_SORT_KEYS)] : options.formatSort;
  const defaultFormat = options.isExtractAudio ? DEFAULT_AUDIO_ONLY_FORMAT : DEFAULT_FORMAT;
  const isFormatNeeded = !options.isSkipDownload || options.prints.length > 0 || options.isDumpJson;
  const isListingOnly = options.isListFormats || options.isListSubs || options.isListThumbnails;
  const formatSets = isFormatNeeded && !isListingOnly ? selectFormatSets(options.format ?? defaultFormat, video.formats, sortKeys) : [];
  const firstSet = formatSets[0] ?? [];
  const printFields: TemplateFields = { ...fields, ...buildFormatFields(firstSet) };
  printFields._filename = firstSet.length ? buildSavePath(options, DEFAULT_OUTPUT_KEY, printFields, pickContainerForPrint(options, firstSet)) : undefined;
  printed.push(...buildPrintLines(options, printFields, video));

  if (isSimulation(options)) {
    return { jobs: [], directFiles: [], printed };
  }

  const notes: string[] = [];
  const tracks = selectCaptionTracks(options, video);
  const wantsSubs = options.isWriteSubs || options.isWriteAutoSubs || options.isEmbedSubs;
  if (wantsSubs && !tracks.length) {
    notes.push("No captions match --sub-langs");
  }

  const companions = buildCompanionFiles(options, context, printFields, tracks);
  const jobs: Job[] = [...companions.jobs];
  if (!options.isSkipDownload) {
    for (const picks of formatSets) {
      const sizeReason = sizeRejection(options, picks);
      if (sizeReason) {
        return { jobs: [], directFiles: [], printed, skipReason: `"${video.title}" ${sizeReason}` };
      }

      const mediaFields: TemplateFields = { ...fields, ...buildFormatFields(picks) };
      const mediaContext: MediaContext = { options, context, fields: mediaFields, picks, tracks, notes };
      const sections = resolveSections(options, context.chapters).map((section, index): SectionContext => ({ ...section, number: index + 1 }));
      const wholeJobs = sections.length ? sections.map(section => buildMediaJob(mediaContext, section, false)) : [buildMediaJob(mediaContext, undefined, false)];
      const chapterJobs = options.isSplitChapters ? context.chapters.map((chapter, index) => buildMediaJob(mediaContext, { ...chapter, number: index + 1 }, true)) : [];
      jobs.unshift(...wholeJobs, ...chapterJobs);
    }
  }

  if (!jobs.length && !companions.directFiles.length) {
    throw new Error(notes[0] ?? "Nothing to do: add --write-subs or drop --skip-download");
  }

  return { jobs, directFiles: companions.directFiles, printed: [...printed, ...notes] };
}

function pickAudioContainer(options: YtDlpOptions, picks: FormatFields[]) {
  if (options.audioFormat !== BEST_AUDIO_FORMAT) {
    return options.audioFormat;
  }

  return picks.find(pick => pick.hasAudio)?.ext ?? "m4a";
}

function pickContainerForPrint(options: YtDlpOptions, picks: FormatFields[]) {
  return options.isExtractAudio ? pickAudioContainer(options, picks) : pickContainer(options, picks);
}

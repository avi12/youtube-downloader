import { tokenize } from "@/lib/command";
import { z } from "zod";

const YTDLP_PROGRAM_PATTERN = /^yt-dlp(?:\.exe)?$/i;
const SECTION_TIME_PATTERN = /^\*(.*)-(.*)$/;
const TIMESTAMP_SEPARATOR = ":";
const SECONDS_PER_STEP = 60;
const FORMAT_LIST_SEPARATOR = "/";
const DEFAULT_OUTPUT_TEMPLATE = "%(title)s [%(id)s].%(ext)s";
const DEFAULT_SUB_FORMAT = "vtt";
const ALL = "all";
const BEST = "best";
const DEFAULT_OUTPUT_KEY = "default";
const NEGATION_PREFIX = "--no-";
const LONG_FLAG_PREFIX = "--";
const PYTHON_NAMED_GROUP = /\(\?P</g;
const OUTPUT_TYPE_PATTERN = /^(subtitle|thumbnail|description|annotation|infojson|link|chapter|pl_thumbnail|pl_description|pl_infojson|pl_video):([\s\S]*)$/;
const PATH_TYPE_PATTERN = /^(home|temp|subtitle|thumbnail|description|infojson|link|chapter):([\s\S]*)$/;
const POSTPROCESSOR_PATTERN = /^([\w+]+):([\s\S]*)$/;
const EQUALS_SIGN = "=";
const AUDIO_QUALITY_PATTERN = /^(?:\d+(?:\.\d+)?|\d+k)$/i;

export const AUDIO_FORMATS = ["best", "aac", "alac", "flac", "m4a", "mp3", "opus", "vorbis", "wav"] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

const CONTAINER_FORMATS = ["avi", "flv", "gif", "mkv", "mov", "mp4", "webm", "aac", "aiff", "alac", "flac", "m4a", "mka", "mp3", "ogg", "opus", "vorbis", "wav"] as const;
const SUBTITLE_FORMATS = ["ass", "lrc", "srt", "vtt"] as const;
const THUMBNAIL_FORMATS = ["jpg", "png", "webp"] as const;

const audioFormatSchema = z.enum(AUDIO_FORMATS);
const containerSchema = z.enum(CONTAINER_FORMATS);
const subtitleFormatSchema = z.enum(SUBTITLE_FORMATS);
const thumbnailFormatSchema = z.enum(THUMBNAIL_FORMATS);
const audioQualitySchema = z.string().regex(AUDIO_QUALITY_PATTERN, "use 0-10 or a bitrate like 128K");
const countSchema = z.coerce.number().int().nonnegative();
const positiveCountSchema = z.coerce.number().int().positive();

type ParseRequest<Schema extends z.ZodType> = {
  flag: string;
  schema: Schema;
  value: string;
};

function parseOptionValue<Schema extends z.ZodType>({ flag, schema, value }: ParseRequest<Schema>): z.output<Schema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`${flag} ${value}: ${result.error.issues[0]?.message ?? "invalid value"}`);
  }

  return result.data;
}
const DEFAULT_PROCESSOR = "ffmpeg";

export type Section = {
  start?: number;
  end?: number;
  chapterPattern?: string;
};

export type MetadataReplacement = {
  fields: string[];
  pattern: string;
  replacement: string;
};

export type YtDlpOptions = {
  urls: string[];
  format?: string;
  formatSort: string[];
  isPreferFree: boolean;
  isExtractAudio: boolean;
  audioFormat: AudioFormat;
  audioQuality?: string;
  mergeOutputFormat?: string;
  recodeVideo?: string;
  outputs: Record<string, string>;
  paths: Record<string, string>;
  isRestrictFilenames: boolean;
  trimFilenames?: number;
  isWriteSubs: boolean;
  isWriteAutoSubs: boolean;
  subLangs: string[];
  subFormat: string;
  isListSubs: boolean;
  isEmbedSubs: boolean;
  isEmbedThumbnail: boolean;
  isEmbedMetadata: boolean;
  isEmbedChapters: boolean;
  isWriteThumbnail: boolean;
  isWriteAllThumbnails: boolean;
  convertThumbnails?: string;
  isListThumbnails: boolean;
  isWriteDescription: boolean;
  isWriteInfoJson: boolean;
  linkKinds: string[];
  isSkipDownload: boolean;
  isSimulate: boolean;
  isNoSimulate: boolean;
  sections: Section[];
  isForceKeyframes: boolean;
  isSplitChapters: boolean;
  isListFormats: boolean;
  prints: string[];
  isDumpJson: boolean;
  matchFilters: string[];
  dateExact?: string;
  dateBefore?: string;
  dateAfter?: string;
  minViews?: number;
  maxViews?: number;
  minFilesize?: string;
  maxFilesize?: string;
  isBreakOnReject: boolean;
  isNoPlaylist: boolean;
  playlistItems?: string;
  playlistStart?: number;
  playlistEnd?: number;
  isPlaylistReverse: boolean;
  isPlaylistRandom: boolean;
  maxDownloads?: number;
  isFlatPlaylist: boolean;
  isAbortOnError: boolean;
  postprocessorArgs: Record<string, string[]>;
  parseMetadata: string[];
  replaceInMetadata: MetadataReplacement[];
  ignoredFlags: string[];
};

type ApplierRequest = {
  options: YtDlpOptions;
  values: string[];
  flag: string;
};
type Applier = (request: ApplierRequest) => void;
type OptionDefinition = {
  flags: string[];
  arity: number;
  apply: Applier;
  isNegatable: boolean;
};
type OptionsValue = {
  options: YtDlpOptions;
  value: string;
};
type ValueRequest = OptionsValue & { flag: string };
type SwitchRequest = {
  options: YtDlpOptions;
  isOn: boolean;
};
type ValueDefinition = {
  flags: string[];
  apply: (request: ValueRequest) => void;
};
type SwitchDefinition = {
  flags: string[];
  apply: (request: SwitchRequest) => void;
};

const definitions = new Map<string, OptionDefinition>();

function register(definition: OptionDefinition) {
  for (const flag of definition.flags) {
    definitions.set(flag, definition);
  }
}

function valueOption({ flags, apply }: ValueDefinition) {
  register({
    flags,
    arity: 1,
    isNegatable: false,
    apply: ({ options, values: [value], flag }) => apply({
      options,
      value: value!,
      flag
    })
  });
}

function switchOption({ flags, apply }: SwitchDefinition) {
  register({
    flags,
    arity: 0,
    isNegatable: true,
    apply: ({ options, values: [marker] }) => apply({
      options,
      isOn: marker !== "off"
    })
  });
}

function splitList(value: string) {
  return value.split(",").map(item => item.trim()).filter(Boolean);
}

function firstOfAlternatives(value: string) {
  return value.split(FORMAT_LIST_SEPARATOR).find(item => item !== BEST) ?? DEFAULT_SUB_FORMAT;
}

function parseConversionTarget(value: string) {
  const entry = value.split(FORMAT_LIST_SEPARATOR).find(item => !item.includes(">")) ?? value.split(FORMAT_LIST_SEPARATOR)[0]!;
  return entry.split(">").at(-1)!;
}

function parseTimestamp(text: string) {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "inf") {
    return undefined;
  }

  const seconds = trimmed
    .split(TIMESTAMP_SEPARATOR)
    .reduce((total, part) => total * SECONDS_PER_STEP + Number(part), 0);
  if (Number.isNaN(seconds)) {
    throw new Error(`Bad time in --download-sections: ${text}`);
  }

  return seconds;
}

function parseSection(value: string): Section {
  const match = value.match(SECTION_TIME_PATTERN);
  if (!match) {
    return { chapterPattern: value };
  }

  return {
    start: parseTimestamp(match[1]!),
    end: parseTimestamp(match[2]!)
  };
}

function parsePrint({ options, value }: OptionsValue) {
  const template = value.replace(/^\w+:/, "");
  options.prints.push(template.includes("%(") ? template : `%(${template})s`);
}

function addPrintField(field: string) {
  return ({ options }: ApplierRequest) => options.prints.push(`%(${field})s`);
}

function parseOutput({ options, value }: OptionsValue) {
  const typed = value.match(OUTPUT_TYPE_PATTERN);
  if (typed) {
    options.outputs[typed[1]!] = typed[2]!;
    return;
  }

  options.outputs[DEFAULT_OUTPUT_KEY] = value;
}

function parsePath({ options, value }: OptionsValue) {
  const typed = value.match(PATH_TYPE_PATTERN);
  if (typed) {
    options.paths[typed[1]!] = typed[2]!;
    return;
  }

  options.paths.home = value;
}

function parsePostprocessorArgs({ options, value }: OptionsValue) {
  const match = value.match(POSTPROCESSOR_PATTERN);
  const name = (match?.[1] ?? DEFAULT_PROCESSOR).toLowerCase();
  const args = tokenize(match?.[2] ?? value);
  options.postprocessorArgs[name] = [...(options.postprocessorArgs[name] ?? []), ...args];
}

function toRegexSource(pattern: string) {
  return pattern.replace(PYTHON_NAMED_GROUP, "(?<");
}

valueOption({
  flags: ["-f", "--format"],
  apply({ options, value }) {
    options.format = value;
  }
});
valueOption({
  flags: ["-S", "--format-sort"],
  apply({ options, value }) {
    options.formatSort = splitList(value);
  }
});
switchOption({
  flags: ["--prefer-free-formats"],
  apply({ options, isOn }) {
    options.isPreferFree = isOn;
  }
});
switchOption({
  flags: ["-x", "--extract-audio"],
  apply({ options, isOn }) {
    options.isExtractAudio = isOn;
  }
});
valueOption({
  flags: ["--audio-format"],
  apply({ options, value, flag }) {
    options.audioFormat = parseOptionValue({
      flag,
      schema: audioFormatSchema,
      value
    });
  }
});
valueOption({
  flags: ["--audio-quality"],
  apply({ options, value, flag }) {
    options.audioQuality = parseOptionValue({
      flag,
      schema: audioQualitySchema,
      value
    });
  }
});
valueOption({
  flags: ["--merge-output-format", "--remux-video"],
  apply({ options, value, flag }) {
    options.mergeOutputFormat = parseOptionValue({
      flag,
      schema: containerSchema,
      value: parseConversionTarget(value)
    });
  }
});
valueOption({
  flags: ["--recode-video"],
  apply({ options, value, flag }) {
    options.recodeVideo = parseOptionValue({
      flag,
      schema: containerSchema,
      value: parseConversionTarget(value)
    });
  }
});
valueOption({
  flags: ["-o", "--output"],
  apply: parseOutput
});
valueOption({
  flags: ["-P", "--paths"],
  apply: parsePath
});
switchOption({
  flags: ["--restrict-filenames"],
  apply({ options, isOn }) {
    options.isRestrictFilenames = isOn;
  }
});
valueOption({
  flags: ["--trim-filenames"],
  apply({ options, value, flag }) {
    options.trimFilenames = parseOptionValue({
      flag,
      schema: positiveCountSchema,
      value
    });
  }
});
switchOption({
  flags: ["--write-subs", "--write-sub"],
  apply({ options, isOn }) {
    options.isWriteSubs = isOn;
  }
});
switchOption({
  flags: ["--write-auto-subs", "--write-automatic-subs"],
  apply({ options, isOn }) {
    options.isWriteAutoSubs = isOn;
  }
});
switchOption({
  flags: ["--all-subs"],
  apply({ options, isOn }) {
    options.isWriteSubs = isOn;
    options.subLangs = [ALL];
  }
});
valueOption({
  flags: ["--sub-langs", "--sub-lang"],
  apply({ options, value }) {
    options.subLangs = splitList(value);
  }
});
valueOption({
  flags: ["--sub-format"],
  apply({ options, value }) {
    options.subFormat = firstOfAlternatives(value);
  }
});
valueOption({
  flags: ["--convert-subs", "--convert-sub"],
  apply({ options, value, flag }) {
    options.subFormat = parseOptionValue({
      flag,
      schema: subtitleFormatSchema,
      value
    });
  }
});
switchOption({
  flags: ["--list-subs"],
  apply({ options, isOn }) {
    options.isListSubs = isOn;
  }
});
switchOption({
  flags: ["--embed-subs"],
  apply({ options, isOn }) {
    options.isEmbedSubs = isOn;
  }
});
switchOption({
  flags: ["--embed-thumbnail"],
  apply({ options, isOn }) {
    options.isEmbedThumbnail = isOn;
  }
});
switchOption({
  flags: ["--embed-metadata", "--add-metadata"],
  apply({ options, isOn }) {
    options.isEmbedMetadata = isOn;
  }
});
switchOption({
  flags: ["--embed-chapters", "--add-chapters"],
  apply({ options, isOn }) {
    options.isEmbedChapters = isOn;
  }
});
switchOption({
  flags: ["--write-thumbnail"],
  apply({ options, isOn }) {
    options.isWriteThumbnail = isOn;
  }
});
switchOption({
  flags: ["--write-all-thumbnails"],
  apply({ options, isOn }) {
    options.isWriteAllThumbnails = isOn;
  }
});
valueOption({
  flags: ["--convert-thumbnails"],
  apply({ options, value, flag }) {
    options.convertThumbnails = parseOptionValue({
      flag,
      schema: thumbnailFormatSchema,
      value: parseConversionTarget(value)
    });
  }
});
switchOption({
  flags: ["--list-thumbnails"],
  apply({ options, isOn }) {
    options.isListThumbnails = isOn;
  }
});
switchOption({
  flags: ["--write-description"],
  apply({ options, isOn }) {
    options.isWriteDescription = isOn;
  }
});
switchOption({
  flags: ["--write-info-json"],
  apply({ options, isOn }) {
    options.isWriteInfoJson = isOn;
  }
});
const LINK_FLAGS = [
  ["--write-link", "url"],
  ["--write-url-link", "url"],
  ["--write-webloc-link", "webloc"],
  ["--write-desktop-link", "desktop"]
] as const;
for (const [flag, kind] of LINK_FLAGS) {
  switchOption({
    flags: [flag],
    apply({ options, isOn }) {
      options.linkKinds = isOn
        ? [...options.linkKinds, kind]
        : options.linkKinds.filter(existing => existing !== kind);
    }
  });
}
switchOption({
  flags: ["--skip-download"],
  apply({ options, isOn }) {
    options.isSkipDownload = isOn;
  }
});
switchOption({
  flags: ["-s", "--simulate"],
  apply({ options, isOn }) {
    options.isSimulate = isOn;
    options.isNoSimulate = !isOn;
  }
});
valueOption({
  flags: ["--download-sections"],
  apply({ options, value }) {
    options.sections.push(parseSection(value));
  }
});
switchOption({
  flags: ["--force-keyframes-at-cuts"],
  apply({ options, isOn }) {
    options.isForceKeyframes = isOn;
  }
});
switchOption({
  flags: ["--split-chapters"],
  apply({ options, isOn }) {
    options.isSplitChapters = isOn;
  }
});
switchOption({
  flags: ["-F", "--list-formats"],
  apply({ options, isOn }) {
    options.isListFormats = isOn;
  }
});
valueOption({
  flags: ["--print"],
  apply: parsePrint
});
switchOption({
  flags: ["-j", "--dump-json", "-J", "--dump-single-json"],
  apply({ options, isOn }) {
    options.isDumpJson = isOn;
  }
});

const PRINT_SHORTCUTS = [
  [["-e", "--get-title"], "title"],
  [["--get-id"], "id"],
  [["-g", "--get-url"], "url"],
  [["--get-thumbnail"], "thumbnail"],
  [["--get-description"], "description"],
  [["--get-duration"], "duration_string"],
  [["--get-filename"], "_filename"],
  [["--get-format"], "format"]
] as const;
for (const [flags, field] of PRINT_SHORTCUTS) {
  register({
    flags: [...flags],
    arity: 0,
    isNegatable: false,
    apply: addPrintField(field)
  });
}
valueOption({
  flags: ["--match-filters", "--match-filter"],
  apply({ options, value }) {
    options.matchFilters.push(value);
  }
});
valueOption({
  flags: ["--break-match-filters"],
  apply({ options, value }) {
    options.matchFilters.push(value);
    options.isBreakOnReject = true;
  }
});
valueOption({
  flags: ["--date"],
  apply({ options, value }) {
    options.dateExact = value;
  }
});
valueOption({
  flags: ["--datebefore"],
  apply({ options, value }) {
    options.dateBefore = value;
  }
});
valueOption({
  flags: ["--dateafter"],
  apply({ options, value }) {
    options.dateAfter = value;
  }
});
valueOption({
  flags: ["--min-views"],
  apply({ options, value, flag }) {
    options.minViews = parseOptionValue({
      flag,
      schema: countSchema,
      value
    });
  }
});
valueOption({
  flags: ["--max-views"],
  apply({ options, value, flag }) {
    options.maxViews = parseOptionValue({
      flag,
      schema: countSchema,
      value
    });
  }
});
valueOption({
  flags: ["--min-filesize"],
  apply({ options, value }) {
    options.minFilesize = value;
  }
});
valueOption({
  flags: ["--max-filesize"],
  apply({ options, value }) {
    options.maxFilesize = value;
  }
});
switchOption({
  flags: ["--break-on-reject"],
  apply({ options, isOn }) {
    options.isBreakOnReject = isOn;
  }
});
switchOption({
  flags: ["--no-playlist"],
  apply({ options, isOn }) {
    options.isNoPlaylist = isOn;
  }
});
switchOption({
  flags: ["--yes-playlist"],
  apply({ options, isOn }) {
    options.isNoPlaylist = !isOn;
  }
});
valueOption({
  flags: ["-I", "--playlist-items"],
  apply({ options, value }) {
    options.playlistItems = value;
  }
});
valueOption({
  flags: ["--playlist-start"],
  apply({ options, value, flag }) {
    options.playlistStart = parseOptionValue({
      flag,
      schema: positiveCountSchema,
      value
    });
  }
});
valueOption({
  flags: ["--playlist-end"],
  apply({ options, value, flag }) {
    options.playlistEnd = parseOptionValue({
      flag,
      schema: positiveCountSchema,
      value
    });
  }
});
switchOption({
  flags: ["--playlist-reverse"],
  apply({ options, isOn }) {
    options.isPlaylistReverse = isOn;
  }
});
switchOption({
  flags: ["--playlist-random"],
  apply({ options, isOn }) {
    options.isPlaylistRandom = isOn;
  }
});
valueOption({
  flags: ["--max-downloads"],
  apply({ options, value, flag }) {
    options.maxDownloads = parseOptionValue({
      flag,
      schema: countSchema,
      value
    });
  }
});
register({
  flags: ["--flat-playlist"],
  arity: 0,
  isNegatable: false,
  apply({ options }) {
    options.isFlatPlaylist = true;
  }
});
register({
  flags: ["--no-flat-playlist"],
  arity: 0,
  isNegatable: false,
  apply({ options }) {
    options.isFlatPlaylist = false;
  }
});
register({
  flags: ["--abort-on-error", "--no-ignore-errors"],
  arity: 0,
  isNegatable: false,
  apply({ options }) {
    options.isAbortOnError = true;
  }
});
register({
  flags: ["-i", "--ignore-errors", "--no-abort-on-error"],
  arity: 0,
  isNegatable: false,
  apply({ options }) {
    options.isAbortOnError = false;
  }
});
valueOption({
  flags: ["--postprocessor-args", "--ppa"],
  apply: parsePostprocessorArgs
});
valueOption({
  flags: ["--parse-metadata"],
  apply({ options, value }) {
    options.parseMetadata.push(value);
  }
});
register({
  flags: ["--replace-in-metadata"],
  arity: 3,
  isNegatable: false,
  apply({ options, values: [fields, pattern, replacement] }) {
    options.replaceInMetadata.push({
      fields: fields!.split(/[\s,]+/),
      pattern: toRegexSource(pattern!),
      replacement: replacement!
    });
  }
});

const IGNORED_SWITCHES = [
  "-h", "--help", "-U", "--update", "--no-update", "--ignore-config", "--no-config", "--no-warnings", "--no-progress", "--progress", "--newline",
  "--console-title", "--quiet", "-q", "--verbose", "-v", "--no-quiet", "--no-colors", "--no-mtime", "--mtime", "--no-part", "--part", "--no-continue", "--continue",
  "--overwrites", "--no-overwrites", "-w", "--force-overwrites", "--windows-filenames", "--no-windows-filenames", "--no-cache-dir", "--rm-cache-dir",
  "--keep-video", "-k", "--no-keep-video", "--keep-fragments", "--no-keep-fragments", "--no-post-overwrites", "--post-overwrites", "--no-check-certificates",
  "--prefer-insecure", "--force-ipv4", "--force-ipv6", "-4", "-6", "--enable-file-urls", "--check-formats", "--check-all-formats", "--no-check-formats",
  "--format-sort-force", "--no-format-sort-force", "--video-multistreams", "--no-video-multistreams", "--audio-multistreams", "--no-audio-multistreams",
  "--allow-unplayable-formats", "--lazy-playlist", "--no-lazy-playlist", "--hls-prefer-native", "--hls-use-mpegts", "--no-hls-use-mpegts", "--live-from-start",
  "--no-live-from-start", "--ignore-no-formats-error", "--no-ignore-no-formats-error", "--mark-watched", "--no-mark-watched", "--no-clean-infojson",
  "--clean-infojson", "--no-write-comments", "--netrc", "-n", "--no-netrc", "--legacy-server-connect", "--no-call-home", "--list-extractors", "--wait-for-video",
  "--dump-pages", "--write-pages", "--print-traffic", "--skip-unavailable-fragments", "-c", "--abort-on-unavailable-fragments", "--no-abort-on-unavailable-fragments",
  "--no-js-runtimes", "--no-remote-components", "--no-embed-info-json", "--embed-info-json", "--xattrs", "--no-xattrs", "--concat-playlist", "--fixup",
  "--no-simulate-extra"
];

const IGNORED_VALUE_OPTIONS = [
  "-r", "--limit-rate", "--throttled-rate", "-R", "--retries", "--file-access-retries", "--fragment-retries", "--retry-sleep", "--sleep-interval", "--min-sleep-interval",
  "--max-sleep-interval", "--sleep-requests", "--sleep-subtitles", "-N", "--concurrent-fragments", "--buffer-size", "--socket-timeout", "--source-address", "--proxy",
  "--geo-verification-proxy", "--xff", "--user-agent", "--referer", "--add-header", "--cookies", "--cookies-from-browser", "-u", "--username", "-p", "--password",
  "-2", "--twofactor", "--video-password", "--ap-mso", "--ap-username", "--ap-password", "--extractor-args", "--extractor-retries", "--compat-options", "--cache-dir",
  "--config-locations", "--color", "--progress-template", "--js-runtimes", "--remote-components", "--impersonate", "--downloader", "--downloader-args", "--hls-split-discontinuity",
  "--age-limit", "--sponsorblock-api", "--convert-subs-args", "--list-impersonate-targets", "--use-postprocessor", "--print-to-file", "--exec", "--netrc-location",
  "--netrc-cmd", "--client-certificate", "--client-certificate-key", "--client-certificate-password", "--fixup", "--replace-in-metadata-ignored"
];

const UNSUPPORTED_REASONS: Record<string, string> = {
  "--exec": "can't run programs from a browser extension",
  "--print-to-file": "can't write to arbitrary paths",
  "--sponsorblock-mark": "needs the SponsorBlock service, which the extension doesn't contact",
  "--sponsorblock-remove": "needs the SponsorBlock service, which the extension doesn't contact",
  "--batch-file": "can't read files, put the URLs in the command",
  "-a": "can't read files, put the URLs in the command",
  "--download-archive": "can't keep an archive file",
  "--load-info-json": "can't read files"
};

const IGNORED_SET = new Set(IGNORED_SWITCHES);
const IGNORED_VALUE_SET = new Set(IGNORED_VALUE_OPTIONS.filter(flag => !(flag in UNSUPPORTED_REASONS)));

function createDefaultOptions(): YtDlpOptions {
  return {
    urls: [],
    formatSort: [],
    isPreferFree: false,
    isExtractAudio: false,
    audioFormat: BEST,
    outputs: {
      [DEFAULT_OUTPUT_KEY]: DEFAULT_OUTPUT_TEMPLATE
    },
    paths: {},
    isRestrictFilenames: false,
    isWriteSubs: false,
    isWriteAutoSubs: false,
    subLangs: [ALL],
    subFormat: DEFAULT_SUB_FORMAT,
    isListSubs: false,
    isEmbedSubs: false,
    isEmbedThumbnail: false,
    isEmbedMetadata: false,
    isEmbedChapters: false,
    isWriteThumbnail: false,
    isWriteAllThumbnails: false,
    isListThumbnails: false,
    isWriteDescription: false,
    isWriteInfoJson: false,
    linkKinds: [],
    isSkipDownload: false,
    isSimulate: false,
    isNoSimulate: false,
    sections: [],
    isForceKeyframes: false,
    isSplitChapters: false,
    isListFormats: false,
    prints: [],
    isDumpJson: false,
    matchFilters: [],
    isBreakOnReject: false,
    isNoPlaylist: false,
    isPlaylistReverse: false,
    isPlaylistRandom: false,
    isFlatPlaylist: false,
    isAbortOnError: false,
    postprocessorArgs: {},
    parseMetadata: [],
    replaceInMetadata: [],
    ignoredFlags: []
  };
}

function splitInlineValue(token: string) {
  const separatorIndex = token.indexOf(EQUALS_SIGN);
  if (!token.startsWith(LONG_FLAG_PREFIX) || separatorIndex === -1) {
    return { flag: token };
  }

  return {
    flag: token.slice(0, separatorIndex),
    inlineValue: token.slice(separatorIndex + 1)
  };
}

function expandShortFlags(token: string) {
  const isShortCluster = /^-[a-zA-Z]{2,}$/.test(token) && !definitions.has(token);
  if (!isShortCluster) {
    return [token];
  }

  const flags = Array.from(token.slice(1), letter => `-${letter}`);
  return flags.every(flag => definitions.get(flag)?.arity === 0 || IGNORED_SET.has(flag)) ? flags : [token];
}

function splitAttachedValue(token: string) {
  const isAttached = /^-[a-zA-Z].+$/.test(token) && !token.startsWith(LONG_FLAG_PREFIX) && !definitions.has(token);
  const flag = token.slice(0, 2);
  if (isAttached && (definitions.get(flag)?.arity ?? 0) > 0) {
    return [flag, token.slice(2)];
  }

  return [token];
}

function resolveDefinition(flag: string) {
  const direct = definitions.get(flag);
  if (direct) {
    return {
      definition: direct,
      isNegated: false
    };
  }

  if (!flag.startsWith(NEGATION_PREFIX)) {
    return undefined;
  }

  const positive = definitions.get(`${LONG_FLAG_PREFIX}${flag.slice(NEGATION_PREFIX.length)}`);
  return positive?.isNegatable ? {
    definition: positive,
    isNegated: true
  } : undefined;
}

type FlagRequest = {
  options: YtDlpOptions;
  rawFlag: string;
  tokens: string[];
  inlineValue?: string;
};

function applyFlag({ options, rawFlag, tokens, inlineValue }: FlagRequest) {
  const resolved = resolveDefinition(rawFlag);
  if (resolved) {
    const { definition, isNegated } = resolved;
    const values = definition.arity === 0 ? [isNegated ? "off" : "on"] : [...(inlineValue === undefined ? [] : [inlineValue]), ...tokens.splice(0, definition.arity - Number(inlineValue !== undefined))];
    if (definition.arity > 0 && values.length < definition.arity) {
      throw new Error(`${rawFlag} needs a value`);
    }

    definition.apply({
      options,
      values,
      flag: rawFlag
    });
    return;
  }

  if (IGNORED_SET.has(rawFlag)) {
    options.ignoredFlags.push(rawFlag);
    return;
  }

  if (IGNORED_VALUE_SET.has(rawFlag)) {
    options.ignoredFlags.push(rawFlag);

    if (inlineValue === undefined) {
      tokens.shift();
    }

    return;
  }

  const reason = UNSUPPORTED_REASONS[rawFlag];
  throw new Error(`Unsupported yt-dlp option ${rawFlag}${reason ? `: ${reason}` : ""}`);
}

export function parseYtDlpCommand(command: string) {
  const tokens = tokenize(command);
  if (YTDLP_PROGRAM_PATTERN.test(tokens[0] ?? "")) {
    tokens.shift();
  }

  const options = createDefaultOptions();
  while (tokens.length) {
    const token = tokens.shift()!;
    if (!token.startsWith("-") || token === "-") {
      options.urls.push(token);
      continue;
    }

    for (const piece of expandShortFlags(token)) {
      const [first, attachedValue] = splitAttachedValue(piece);
      const { flag, inlineValue } = splitInlineValue(first!);
      applyFlag({
        options,
        rawFlag: flag,
        tokens,
        inlineValue: attachedValue ?? inlineValue
      });
    }
  }

  return options;
}

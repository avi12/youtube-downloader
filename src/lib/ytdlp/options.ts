import { tokenize } from "@/lib/command";

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
const DEFAULT_PROCESSOR = "ffmpeg";

export type Section = { start?: number; end?: number; chapterPattern?: string };

export type MetadataReplacement = { fields: string[]; pattern: string; replacement: string };

export type YtDlpOptions = {
  urls: string[];
  format?: string;
  formatSort: string[];
  isPreferFree: boolean;
  isExtractAudio: boolean;
  audioFormat: string;
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

type Applier = (options: YtDlpOptions, values: string[]) => void;
type OptionDefinition = { flags: string[]; arity: number; apply: Applier; isNegatable: boolean };

const definitions = new Map<string, OptionDefinition>();

function register(flags: string[], arity: number, isNegatable: boolean, apply: Applier) {
  const definition = { flags, arity, apply, isNegatable };
  for (const flag of flags) {
    definitions.set(flag, definition);
  }
}

function valueOption(flags: string[], apply: (options: YtDlpOptions, value: string) => void) {
  register(flags, 1, false, (options, [value]) => apply(options, value!));
}

function switchOption(flags: string[], apply: (options: YtDlpOptions, isOn: boolean) => void) {
  register(flags, 0, true, (options, [marker]) => apply(options, marker !== "off"));
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

  const seconds = trimmed.split(TIMESTAMP_SEPARATOR).reduce((total, part) => total * SECONDS_PER_STEP + Number(part), 0);
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

  return { start: parseTimestamp(match[1]!), end: parseTimestamp(match[2]!) };
}

function parsePrint(options: YtDlpOptions, value: string) {
  const template = value.replace(/^\w+:/, "");
  options.prints.push(template.includes("%(") ? template : `%(${template})s`);
}

function addPrintField(field: string) {
  return (options: YtDlpOptions) => options.prints.push(`%(${field})s`);
}

function parseOutput(options: YtDlpOptions, value: string) {
  const typed = value.match(OUTPUT_TYPE_PATTERN);
  if (typed) {
    options.outputs[typed[1]!] = typed[2]!;
    return;
  }

  options.outputs[DEFAULT_OUTPUT_KEY] = value;
}

function parsePath(options: YtDlpOptions, value: string) {
  const typed = value.match(PATH_TYPE_PATTERN);
  if (typed) {
    options.paths[typed[1]!] = typed[2]!;
    return;
  }

  options.paths.home = value;
}

function parsePostprocessorArgs(options: YtDlpOptions, value: string) {
  const match = value.match(POSTPROCESSOR_PATTERN);
  const name = (match?.[1] ?? DEFAULT_PROCESSOR).toLowerCase();
  const args = tokenize(match?.[2] ?? value);
  options.postprocessorArgs[name] = [...(options.postprocessorArgs[name] ?? []), ...args];
}

function toRegexSource(pattern: string) {
  return pattern.replace(PYTHON_NAMED_GROUP, "(?<");
}

valueOption(["-f", "--format"], (options, value) => {
  options.format = value;
});
valueOption(["-S", "--format-sort"], (options, value) => {
  options.formatSort = splitList(value);
});
switchOption(["--prefer-free-formats"], (options, isOn) => {
  options.isPreferFree = isOn;
});
switchOption(["-x", "--extract-audio"], (options, isOn) => {
  options.isExtractAudio = isOn;
});
valueOption(["--audio-format"], (options, value) => {
  options.audioFormat = value;
});
valueOption(["--audio-quality"], (options, value) => {
  options.audioQuality = value;
});
valueOption(["--merge-output-format", "--remux-video"], (options, value) => {
  options.mergeOutputFormat = parseConversionTarget(value);
});
valueOption(["--recode-video"], (options, value) => {
  options.recodeVideo = parseConversionTarget(value);
});
valueOption(["-o", "--output"], parseOutput);
valueOption(["-P", "--paths"], parsePath);
switchOption(["--restrict-filenames"], (options, isOn) => {
  options.isRestrictFilenames = isOn;
});
valueOption(["--trim-filenames"], (options, value) => {
  options.trimFilenames = Number(value);
});
switchOption(["--write-subs", "--write-sub"], (options, isOn) => {
  options.isWriteSubs = isOn;
});
switchOption(["--write-auto-subs", "--write-automatic-subs"], (options, isOn) => {
  options.isWriteAutoSubs = isOn;
});
switchOption(["--all-subs"], (options, isOn) => {
  options.isWriteSubs = isOn;
  options.subLangs = [ALL];
});
valueOption(["--sub-langs", "--sub-lang"], (options, value) => {
  options.subLangs = splitList(value);
});
valueOption(["--sub-format"], (options, value) => {
  options.subFormat = firstOfAlternatives(value);
});
valueOption(["--convert-subs", "--convert-sub"], (options, value) => {
  options.subFormat = value;
});
switchOption(["--list-subs"], (options, isOn) => {
  options.isListSubs = isOn;
});
switchOption(["--embed-subs"], (options, isOn) => {
  options.isEmbedSubs = isOn;
});
switchOption(["--embed-thumbnail"], (options, isOn) => {
  options.isEmbedThumbnail = isOn;
});
switchOption(["--embed-metadata", "--add-metadata"], (options, isOn) => {
  options.isEmbedMetadata = isOn;
});
switchOption(["--embed-chapters", "--add-chapters"], (options, isOn) => {
  options.isEmbedChapters = isOn;
});
switchOption(["--write-thumbnail"], (options, isOn) => {
  options.isWriteThumbnail = isOn;
});
switchOption(["--write-all-thumbnails"], (options, isOn) => {
  options.isWriteAllThumbnails = isOn;
});
valueOption(["--convert-thumbnails"], (options, value) => {
  options.convertThumbnails = parseConversionTarget(value);
});
switchOption(["--list-thumbnails"], (options, isOn) => {
  options.isListThumbnails = isOn;
});
switchOption(["--write-description"], (options, isOn) => {
  options.isWriteDescription = isOn;
});
switchOption(["--write-info-json"], (options, isOn) => {
  options.isWriteInfoJson = isOn;
});
for (const [flag, kind] of [["--write-link", "url"], ["--write-url-link", "url"], ["--write-webloc-link", "webloc"], ["--write-desktop-link", "desktop"]] as const) {
  switchOption([flag], (options, isOn) => {
    options.linkKinds = isOn ? [...options.linkKinds, kind] : options.linkKinds.filter(existing => existing !== kind);
  });
}
switchOption(["--skip-download"], (options, isOn) => {
  options.isSkipDownload = isOn;
});
switchOption(["-s", "--simulate"], (options, isOn) => {
  options.isSimulate = isOn;
  options.isNoSimulate = !isOn;
});
valueOption(["--download-sections"], (options, value) => {
  options.sections.push(parseSection(value));
});
switchOption(["--force-keyframes-at-cuts"], (options, isOn) => {
  options.isForceKeyframes = isOn;
});
switchOption(["--split-chapters"], (options, isOn) => {
  options.isSplitChapters = isOn;
});
switchOption(["-F", "--list-formats"], (options, isOn) => {
  options.isListFormats = isOn;
});
valueOption(["--print"], parsePrint);
switchOption(["-j", "--dump-json", "-J", "--dump-single-json"], (options, isOn) => {
  options.isDumpJson = isOn;
});
register(["-e", "--get-title"], 0, false, addPrintField("title"));
register(["--get-id"], 0, false, addPrintField("id"));
register(["-g", "--get-url"], 0, false, addPrintField("url"));
register(["--get-thumbnail"], 0, false, addPrintField("thumbnail"));
register(["--get-description"], 0, false, addPrintField("description"));
register(["--get-duration"], 0, false, addPrintField("duration_string"));
register(["--get-filename"], 0, false, addPrintField("_filename"));
register(["--get-format"], 0, false, addPrintField("format"));
valueOption(["--match-filters", "--match-filter"], (options, value) => {
  options.matchFilters.push(value);
});
valueOption(["--break-match-filters"], (options, value) => {
  options.matchFilters.push(value);
  options.isBreakOnReject = true;
});
valueOption(["--date"], (options, value) => {
  options.dateExact = value;
});
valueOption(["--datebefore"], (options, value) => {
  options.dateBefore = value;
});
valueOption(["--dateafter"], (options, value) => {
  options.dateAfter = value;
});
valueOption(["--min-views"], (options, value) => {
  options.minViews = Number(value);
});
valueOption(["--max-views"], (options, value) => {
  options.maxViews = Number(value);
});
valueOption(["--min-filesize"], (options, value) => {
  options.minFilesize = value;
});
valueOption(["--max-filesize"], (options, value) => {
  options.maxFilesize = value;
});
switchOption(["--break-on-reject"], (options, isOn) => {
  options.isBreakOnReject = isOn;
});
switchOption(["--no-playlist"], (options, isOn) => {
  options.isNoPlaylist = isOn;
});
switchOption(["--yes-playlist"], (options, isOn) => {
  options.isNoPlaylist = !isOn;
});
valueOption(["-I", "--playlist-items"], (options, value) => {
  options.playlistItems = value;
});
valueOption(["--playlist-start"], (options, value) => {
  options.playlistStart = Number(value);
});
valueOption(["--playlist-end"], (options, value) => {
  options.playlistEnd = Number(value);
});
switchOption(["--playlist-reverse"], (options, isOn) => {
  options.isPlaylistReverse = isOn;
});
switchOption(["--playlist-random"], (options, isOn) => {
  options.isPlaylistRandom = isOn;
});
valueOption(["--max-downloads"], (options, value) => {
  options.maxDownloads = Number(value);
});
register(["--flat-playlist"], 0, false, options => {
  options.isFlatPlaylist = true;
});
register(["--no-flat-playlist"], 0, false, options => {
  options.isFlatPlaylist = false;
});
register(["--abort-on-error", "--no-ignore-errors"], 0, false, options => {
  options.isAbortOnError = true;
});
register(["-i", "--ignore-errors", "--no-abort-on-error"], 0, false, options => {
  options.isAbortOnError = false;
});
valueOption(["--postprocessor-args", "--ppa"], parsePostprocessorArgs);
valueOption(["--parse-metadata"], (options, value) => {
  options.parseMetadata.push(value);
});
register(["--replace-in-metadata"], 3, false, (options, [fields, pattern, replacement]) => {
  options.replaceInMetadata.push({ fields: fields!.split(/[\s,]+/), pattern: toRegexSource(pattern!), replacement: replacement! });
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
    outputs: { [DEFAULT_OUTPUT_KEY]: DEFAULT_OUTPUT_TEMPLATE },
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

  return { flag: token.slice(0, separatorIndex), inlineValue: token.slice(separatorIndex + 1) };
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
    return { definition: direct, isNegated: false };
  }

  if (!flag.startsWith(NEGATION_PREFIX)) {
    return undefined;
  }

  const positive = definitions.get(`${LONG_FLAG_PREFIX}${flag.slice(NEGATION_PREFIX.length)}`);
  return positive?.isNegatable ? { definition: positive, isNegated: true } : undefined;
}

function applyFlag(options: YtDlpOptions, rawFlag: string, tokens: string[], inlineValue?: string) {
  const resolved = resolveDefinition(rawFlag);
  if (resolved) {
    const { definition, isNegated } = resolved;
    const values = definition.arity === 0 ? [isNegated ? "off" : "on"] : [...(inlineValue === undefined ? [] : [inlineValue]), ...tokens.splice(0, definition.arity - Number(inlineValue !== undefined))];
    if (definition.arity > 0 && values.length < definition.arity) {
      throw new Error(`${rawFlag} needs a value`);
    }

    definition.apply(options, values);
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
      applyFlag(options, flag, tokens, attachedValue ?? inlineValue);
    }
  }

  return options;
}

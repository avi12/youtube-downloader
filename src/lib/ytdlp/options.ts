import { tokenize } from "@/lib/command";

const YTDLP_PROGRAM_PATTERN = /^yt-dlp(?:\.exe)?$/i;
const SECTION_PATTERN = /^\*(.*)-(.*)$/;
const TIMESTAMP_SEPARATOR = ":";
const SECONDS_PER_STEP = 60;
const FORMAT_LIST_SEPARATOR = "/";
const DEFAULT_OUTPUT_TEMPLATE = "%(title)s [%(id)s].%(ext)s";
const DEFAULT_SUB_FORMAT = "vtt";
const DEFAULT_SUB_LANGS = ["all"];
const DEFAULT_AUDIO_FORMAT = "best";

export type Section = { start?: number; end?: number };

export type YtDlpOptions = {
  url?: string;
  format?: string;
  formatSort: string[];
  isExtractAudio: boolean;
  audioFormat: string;
  audioQuality?: string;
  mergeOutputFormat?: string;
  recodeVideo?: string;
  output: string;
  isWriteSubs: boolean;
  isWriteAutoSubs: boolean;
  subLangs: string[];
  subFormat: string;
  isSkipDownload: boolean;
  section?: Section;
  isListFormats: boolean;
};

type ValueHandler = (options: YtDlpOptions, value: string) => void;
type SwitchHandler = (options: YtDlpOptions) => void;

const FLAG_ALIASES: Record<string, string> = {
  "-f": "--format",
  "-S": "--format-sort",
  "-x": "--extract-audio",
  "-o": "--output",
  "-F": "--list-formats",
  "--write-automatic-subs": "--write-auto-subs",
  "--write-sub": "--write-subs",
  "--sub-lang": "--sub-langs",
  "--convert-sub": "--convert-subs",
  "--remux-video": "--merge-output-format"
};

const VALUE_HANDLERS: Record<string, ValueHandler> = {
  "--format"(options, value) {
    options.format = value;
  },
  "--format-sort"(options, value) {
    options.formatSort = value.split(",").map(key => key.trim()).filter(Boolean);
  },
  "--audio-format"(options, value) {
    options.audioFormat = value;
  },
  "--audio-quality"(options, value) {
    options.audioQuality = value;
  },
  "--merge-output-format"(options, value) {
    options.mergeOutputFormat = value.split(FORMAT_LIST_SEPARATOR)[0];
  },
  "--recode-video"(options, value) {
    options.recodeVideo = value;
  },
  "--output"(options, value) {
    options.output = value;
  },
  "--sub-langs"(options, value) {
    options.subLangs = value.split(",").map(language => language.trim()).filter(Boolean);
  },
  "--sub-format"(options, value) {
    options.subFormat = value.split(FORMAT_LIST_SEPARATOR).find(format => format !== DEFAULT_AUDIO_FORMAT) ?? DEFAULT_SUB_FORMAT;
  },
  "--convert-subs"(options, value) {
    options.subFormat = value;
  },
  "--download-sections"(options, value) {
    options.section = parseSection(value);
  }
};

const SWITCH_HANDLERS: Record<string, SwitchHandler> = {
  "--extract-audio"(options) {
    options.isExtractAudio = true;
  },
  "--write-subs"(options) {
    options.isWriteSubs = true;
  },
  "--write-auto-subs"(options) {
    options.isWriteAutoSubs = true;
  },
  "--all-subs"(options) {
    options.isWriteSubs = true;
    options.subLangs = DEFAULT_SUB_LANGS;
  },
  "--skip-download"(options) {
    options.isSkipDownload = true;
  },
  "--list-formats"(options) {
    options.isListFormats = true;
  }
};

const IGNORED_FLAGS = new Set([
  "--no-playlist",
  "--no-warnings",
  "--no-progress",
  "--no-mtime",
  "--no-part",
  "--no-overwrites",
  "--force-overwrites",
  "--ignore-errors",
  "--no-colors",
  "--quiet",
  "--verbose",
  "-q",
  "-v",
  "-i",
  "-w"
]);

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
  const match = value.match(SECTION_PATTERN);
  if (!match) {
    throw new Error(`Only time ranges like "*10-20" are supported for --download-sections`);
  }

  return { start: parseTimestamp(match[1]!), end: parseTimestamp(match[2]!) };
}

function createDefaultOptions(): YtDlpOptions {
  return {
    formatSort: [],
    isExtractAudio: false,
    audioFormat: DEFAULT_AUDIO_FORMAT,
    output: DEFAULT_OUTPUT_TEMPLATE,
    isWriteSubs: false,
    isWriteAutoSubs: false,
    subLangs: DEFAULT_SUB_LANGS,
    subFormat: DEFAULT_SUB_FORMAT,
    isSkipDownload: false,
    isListFormats: false
  };
}

function splitInlineValue(token: string) {
  const isLongFlag = token.startsWith("--");
  const separatorIndex = token.indexOf("=");
  if (!isLongFlag || separatorIndex === -1) {
    return { flag: token };
  }

  return { flag: token.slice(0, separatorIndex), inlineValue: token.slice(separatorIndex + 1) };
}

export function parseYtDlpCommand(command: string) {
  const tokens = tokenize(command);
  if (YTDLP_PROGRAM_PATTERN.test(tokens[0] ?? "")) {
    tokens.shift();
  }

  const options = createDefaultOptions();
  while (tokens.length) {
    const token = tokens.shift()!;
    if (!token.startsWith("-")) {
      options.url = token;
      continue;
    }

    const { flag: rawFlag, inlineValue } = splitInlineValue(token);
    const flag = FLAG_ALIASES[rawFlag] ?? rawFlag;
    const valueHandler = VALUE_HANDLERS[flag];
    if (valueHandler) {
      const value = inlineValue ?? tokens.shift();
      if (value === undefined) {
        throw new Error(`${rawFlag} needs a value`);
      }

      valueHandler(options, value);
      continue;
    }

    const switchHandler = SWITCH_HANDLERS[flag];
    if (switchHandler) {
      switchHandler(options);
      continue;
    }

    if (!IGNORED_FLAGS.has(flag)) {
      throw new Error(`Unsupported yt-dlp option: ${rawFlag}`);
    }
  }

  return options;
}

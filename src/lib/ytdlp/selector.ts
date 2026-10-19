import type { StreamFormat } from "@/lib/schemas";

const KILOBIT = 1000;
const NUMBER_WITH_SUFFIX_PATTERN = /^(\d+(?:\.\d+)?)([kmgt])?(i?b)?$/i;
const FILTER_PATTERN = /^\[\s*(\w+)\s*(!?)(\^=|\$=|\*=|~=|<=|>=|=|<|>)(\??)\s*(.*?)\s*\]$/;
const SORT_KEY_PATTERN = /^(\+?)(\w+)(?::(.+))?$/;
const CODEC_LIST_PATTERN = /codecs="([^"]*)"/;
const AUDIO_CODEC_PATTERN = /^(mp4a|opus|vorbis|ac-3|ec-3|flac|alac)/;
const NO_CODEC = "none";
const SUFFIX_EXPONENTS: Record<string, number> = { k: 1, m: 2, g: 3, t: 4 };
const BINARY_BASE = 1024;
const DECIMAL_BASE = 1000;
export const DEFAULT_SORT_KEYS = ["res", "fps", "vcodec", "acodec", "br"];
const VIDEO_CODEC_RANK = ["av01", "vp09", "vp9", "hev1", "hvc1", "avc1", "vp8"];
const AUDIO_CODEC_RANK = ["flac", "alac", "opus", "vorbis", "mp4a", "ac-3", "ec-3"];

export type FormatFields = {
  format: StreamFormat;
  format_id: string;
  ext: string;
  height?: number;
  width?: number;
  fps?: number;
  vcodec: string;
  acodec: string;
  abr?: number;
  vbr?: number;
  tbr: number;
  filesize?: number;
  language?: string;
  hasVideo: boolean;
  hasAudio: boolean;
  resolution: string;
};

type Comparator = (first: FormatFields, second: FormatFields) => number;

export function describeFormat(format: StreamFormat): FormatFields {
  const codecs = format.mimeType.match(CODEC_LIST_PATTERN)?.[1]?.split(",").map(codec => codec.trim()) ?? [];
  const audioCodec = codecs.find(codec => AUDIO_CODEC_PATTERN.test(codec));
  const videoCodec = codecs.find(codec => !AUDIO_CODEC_PATTERN.test(codec));
  const hasVideo = format.mimeType.startsWith("video/");
  const hasAudio = Boolean(audioCodec) || format.mimeType.startsWith("audio/");
  const isMp4 = format.mimeType.includes("mp4");
  const mp4Extension = hasVideo ? "mp4" : "m4a";
  const bitrateKilobits = format.bitrate / KILOBIT;
  return {
    format,
    format_id: String(format.itag),
    ext: isMp4 ? mp4Extension : "webm",
    height: format.height,
    width: format.width,
    fps: format.fps,
    vcodec: hasVideo ? (videoCodec ?? "unknown") : NO_CODEC,
    acodec: hasAudio ? (audioCodec ?? "unknown") : NO_CODEC,
    abr: hasVideo ? undefined : bitrateKilobits,
    vbr: hasVideo ? bitrateKilobits : undefined,
    tbr: bitrateKilobits,
    filesize: Number(format.contentLength) || undefined,
    language: format.audioTrack?.id.split(".")[0],
    hasVideo,
    hasAudio,
    resolution: hasVideo ? `${format.width ?? "?"}x${format.height ?? "?"}` : "audio only"
  };
}

function readField(fields: FormatFields, name: string) {
  const readers: Record<string, string | number | undefined> = {
    format_id: fields.format_id,
    ext: fields.ext,
    height: fields.height,
    width: fields.width,
    fps: fields.fps,
    vcodec: fields.vcodec,
    acodec: fields.acodec,
    abr: fields.abr,
    vbr: fields.vbr,
    tbr: fields.tbr,
    filesize: fields.filesize,
    language: fields.language,
    resolution: fields.resolution
  };
  return readers[name];
}

export function parseNumber(text: string) {
  const match = text.match(NUMBER_WITH_SUFFIX_PATTERN);
  if (!match) {
    return undefined;
  }

  const [, digits, suffix, binaryMarker] = match;
  const base = binaryMarker?.toLowerCase().startsWith("i") ? BINARY_BASE : DECIMAL_BASE;
  return Number(digits) * base ** (suffix ? SUFFIX_EXPONENTS[suffix.toLowerCase()]! : 0);
}

function compareNumbers(operator: string, actual: number, expected: number) {
  const comparisons: Record<string, boolean> = {
    "=": actual === expected,
    "<": actual < expected,
    "<=": actual <= expected,
    ">": actual > expected,
    ">=": actual >= expected
  };
  return comparisons[operator] ?? false;
}

function compareStrings(operator: string, actual: string, expected: string) {
  const comparisons: Record<string, () => boolean> = {
    "=": () => actual === expected,
    "^=": () => actual.startsWith(expected),
    "$=": () => actual.endsWith(expected),
    "*=": () => actual.includes(expected),
    "~=": () => new RegExp(expected).test(actual)
  };
  return comparisons[operator]?.() ?? false;
}

export type FieldReader = (name: string) => string | number | undefined;

export function matchesComparison(read: FieldReader, filterText: string) {
  const match = filterText.match(FILTER_PATTERN);
  if (!match) {
    throw new Error(`Can't read the format filter ${filterText}`);
  }

  const [, name, negation, operator, noneOk, expectedText] = match;
  const actual = read(name!);
  if (actual === undefined) {
    return Boolean(noneOk);
  }

  const expectedNumber = parseNumber(expectedText!);
  const isNumeric = typeof actual === "number" && expectedNumber !== undefined;
  const isMatch = isNumeric ? compareNumbers(operator!, actual, expectedNumber) : compareStrings(operator!, String(actual), expectedText!);
  return negation ? !isMatch : isMatch;
}

function splitOutsideBrackets(text: string, separator: string) {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of text) {
    depth += Number(character === "[") - Number(character === "]");
    if (character === separator && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  parts.push(current);
  return parts;
}

function splitFilters(text: string) {
  const filters: string[] = [];
  let remaining = text;
  while (remaining) {
    const closing = remaining.indexOf("]");
    if (closing === -1) {
      throw new Error(`Unclosed format filter in ${text}`);
    }

    filters.push(remaining.slice(0, closing + 1));
    remaining = remaining.slice(closing + 1);
  }

  return filters;
}

function rankOf(codec: string, ranking: string[]) {
  const index = ranking.findIndex(prefix => codec.startsWith(prefix));
  return index === -1 ? -1 : ranking.length - index;
}

const SORT_FIELD_READERS: Record<string, (fields: FormatFields) => number> = {
  res: fields => fields.height ?? 0,
  height: fields => fields.height ?? 0,
  fps: fields => fields.fps ?? 0,
  br: fields => fields.tbr,
  tbr: fields => fields.tbr,
  vbr: fields => fields.vbr ?? 0,
  abr: fields => fields.abr ?? 0,
  size: fields => fields.filesize ?? 0,
  filesize: fields => fields.filesize ?? 0,
  vcodec: fields => rankOf(fields.vcodec, VIDEO_CODEC_RANK),
  acodec: fields => rankOf(fields.acodec, AUDIO_CODEC_RANK),
  free: fields => Number(fields.ext === "webm")
};

function buildSortScorer(sortKey: string) {
  const match = sortKey.match(SORT_KEY_PATTERN);
  const read = SORT_FIELD_READERS[match?.[2] ?? ""];
  if (!match || !read) {
    throw new Error(`Unsupported sort field: ${sortKey}`);
  }

  const [, reverseMarker, , limitText] = match;
  const limit = limitText === undefined ? undefined : parseNumber(limitText);
  const direction = reverseMarker ? -1 : 1;
  return (fields: FormatFields) => {
    const value = read(fields);
    const limited = limit !== undefined && value > limit ? -value : value;
    return direction * limited;
  };
}

function isDefaultTrack(fields: FormatFields) {
  return Number(fields.format.audioTrack?.audioIsDefault ?? false);
}

function buildComparator(sortKeys: string[]): Comparator {
  const scorers = (sortKeys.length ? sortKeys : DEFAULT_SORT_KEYS).map(buildSortScorer);
  return (first, second) => {
    const defaultTrackDifference = isDefaultTrack(second) - isDefaultTrack(first);
    if (defaultTrackDifference) {
      return defaultTrackDifference;
    }

    for (const score of scorers) {
      const difference = score(second) - score(first);
      if (difference) {
        return difference;
      }
    }

    return 0;
  };
}

type NameRule = { isWorst: boolean; matches: (fields: FormatFields) => boolean };

function defineRule(names: string[], isWorst: boolean, matches: NameRule["matches"]) {
  return names.map((name): [string, NameRule] => [name, { isWorst, matches }]);
}

const NAME_RULES = new Map<string, NameRule>([
  ...defineRule(["b", "best"], false, fields => fields.hasVideo && fields.hasAudio),
  ...defineRule(["w", "worst"], true, fields => fields.hasVideo && fields.hasAudio),
  ...defineRule(["bv", "bestvideo"], false, fields => fields.hasVideo && !fields.hasAudio),
  ...defineRule(["wv", "worstvideo"], true, fields => fields.hasVideo && !fields.hasAudio),
  ...defineRule(["bv*", "bestvideo*"], false, fields => fields.hasVideo),
  ...defineRule(["wv*", "worstvideo*"], true, fields => fields.hasVideo),
  ...defineRule(["ba", "bestaudio"], false, fields => fields.hasAudio && !fields.hasVideo),
  ...defineRule(["wa", "worstaudio"], true, fields => fields.hasAudio && !fields.hasVideo),
  ...defineRule(["ba*", "bestaudio*"], false, fields => fields.hasAudio),
  ...defineRule(["wa*", "worstaudio*"], true, fields => fields.hasAudio)
]);

const EXTENSION_NAMES = new Set(["mp4", "m4a", "webm"]);

function resolveItem(item: string, candidates: FormatFields[], compare: Comparator) {
  const trimmed = item.trim();
  const filterStart = trimmed.indexOf("[");
  const name = filterStart === -1 ? trimmed : trimmed.slice(0, filterStart);
  const filterTexts = filterStart === -1 ? [] : splitFilters(trimmed.slice(filterStart));
  const rule = NAME_RULES.get(name) ?? (EXTENSION_NAMES.has(name) ? { isWorst: false, matches: (fields: FormatFields) => fields.ext === name } : undefined);
  const named = rule ? candidates.filter(rule.matches) : candidates.filter(fields => fields.format_id === name);
  const ordered = named.filter(fields => filterTexts.every(filterText => matchesComparison(name => readField(fields, name), filterText))).sort(compare);
  return rule?.isWorst ? ordered.at(-1) : ordered[0];
}

function selectOneSet(selector: string, candidates: FormatFields[], compare: Comparator) {
  for (const alternative of splitOutsideBrackets(selector, "/")) {
    const picks = splitOutsideBrackets(alternative, "+").map(item => resolveItem(item, candidates, compare));
    const resolved = picks.filter(pick => pick !== undefined);
    if (resolved.length === picks.length) {
      return resolved;
    }
  }

  throw new Error(`No format matches "${selector}"`);
}

export function selectFormatSets(selector: string, formats: StreamFormat[], sortKeys: string[]) {
  const candidates = formats.map(describeFormat);
  const compare = buildComparator(sortKeys);
  return splitOutsideBrackets(selector, ",").map(part => selectOneSet(part, candidates, compare));
}

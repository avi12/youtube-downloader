import type { YtDlpOptions } from "./options";
import type { FormatFields } from "./selector";
import { renderTemplate } from "./template";
import type { TemplateFields } from "./template";
import type { ResolvedVideo } from "@/lib/youtube";

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const PYTHON_NAMED_GROUP = /\(\?P</g;
const PYTHON_INLINE_FLAGS = /^\(\?([a-z]+)\)/;
const BACKREFERENCE_PATTERN = /\\(\d)/g;
const ILLEGAL_FILENAME_PATTERN = /[\\:*?"<>|]/g;
const FIRST_PRINTABLE_CODE = 32;
const RESTRICTED_FILENAME_PATTERN = /[^\w.-]+/g;
const TRAILING_DOTS_PATTERN = /[. ]+$/;
const LEADING_DOTS_PATTERN = /^\.+/;
const ABSOLUTE_PATH_PATTERN = /^(?:[\\/]|[a-zA-Z]:)/;
const EXTENSION_PATTERN = /\.\w{1,8}$/;
const UNESCAPED_COLON_PATTERN = /(?<!\\):/;
const NAMED_GROUP_MARKER = /\(\?P?</;
const SINGLE_FIELD_PATTERN = /^%\((\w+)\)s$/;
const MAX_SEGMENT_LENGTH = 200;
const TWO_DIGITS = 2;
const BYTE_UNIT = 1024;

export type PlaylistPosition = {
  id: string;
  title: string;
  index: number;
  count: number;
};
export type Chapter = {
  title: string;
  start: number;
  end: number;
};
export type SectionContext = {
  title?: string;
  number: number;
  start?: number;
  end?: number;
};
export type VideoFieldsRequest = {
  video: ResolvedVideo;
  playlist?: PlaylistPosition;
  autonumber?: number;
};
export type MetadataRulesRequest = {
  fields: TemplateFields;
  options: YtDlpOptions;
};
export type SavePathRequest = {
  options: YtDlpOptions;
  type: string;
  fields: TemplateFields;
  extension: string;
};
type ParseRuleRequest = {
  fields: TemplateFields;
  rule: string;
};
type SanitizeRequest = {
  text: string;
  options: YtDlpOptions;
};
type ExtensionRequest = {
  name: string;
  extension: string;
};

export function formatDurationString(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = Math.floor(totalSeconds % SECONDS_PER_MINUTE);
  const tail = `${String(minutes).padStart(hours ? TWO_DIGITS : 1, "0")}:${String(seconds).padStart(TWO_DIGITS, "0")}`;
  return hours ? `${hours}:${tail}` : tail;
}

export function buildVideoFields({ video, playlist, autonumber = 1 }: VideoFieldsRequest): TemplateFields {
  const thumbnail = video.thumbnails.at(-1)?.url;
  return {
    id: video.id,
    title: video.title,
    fulltitle: video.title,
    uploader: video.uploader,
    channel: video.uploader,
    uploader_id: video.channelId,
    channel_id: video.channelId,
    duration: video.durationSeconds,
    duration_string: formatDurationString(video.durationSeconds),
    upload_date: video.uploadDate || undefined,
    view_count: video.viewCount,
    description: video.description,
    thumbnail,
    webpage_url: `https://www.youtube.com/watch?v=${video.id}`,
    categories: video.category ? [video.category] : [],
    tags: video.tags,
    is_live: video.isLive,
    epoch: Math.floor(Date.now() / 1000),
    autonumber,
    playlist_id: playlist?.id,
    playlist: playlist?.title,
    playlist_title: playlist?.title,
    playlist_index: playlist?.index,
    playlist_count: playlist?.count,
    n_entries: playlist?.count
  };
}

export function buildFormatFields(picks: FormatFields[]): TemplateFields {
  const primary = picks.find(fields => fields.hasVideo) ?? picks[0];
  const audio = picks.find(fields => fields.hasAudio);
  return {
    format_id: picks.map(fields => fields.format_id).join("+"),
    format: picks.map(fields => `${fields.format_id} - ${fields.resolution}`).join("+"),
    resolution: primary?.resolution,
    height: primary?.hasVideo ? primary.height : undefined,
    width: primary?.hasVideo ? primary.width : undefined,
    fps: primary?.fps,
    vcodec: primary?.vcodec,
    acodec: audio?.acodec,
    abr: audio?.abr,
    tbr: picks.reduce((total, fields) => total + fields.tbr, 0),
    language: audio?.language,
    filesize: picks.reduce((total, fields) => total + (fields.filesize ?? 0), 0) || undefined,
    url: primary?.format.url
  };
}

export function buildSectionFields(section?: SectionContext): TemplateFields {
  return {
    section_title: section?.title,
    section_number: section?.number,
    section_start: section?.start,
    section_end: section?.end
  };
}

function toJavaScriptRegex(pattern: string) {
  const inline = pattern.match(PYTHON_INLINE_FLAGS);
  const flags = inline ? inline[1]!.split("").filter(flag => "ims".includes(flag)).join("") : "";
  const source = pattern.replace(PYTHON_INLINE_FLAGS, "").replace(PYTHON_NAMED_GROUP, "(?<");
  return new RegExp(source, flags);
}

function unescapeColon(text: string) {
  return text.replaceAll("\\:", ":");
}

function applyParseRule({ fields, rule }: ParseRuleRequest) {
  const parts = rule.split(UNESCAPED_COLON_PATTERN);
  if (parts.length < TWO_DIGITS) {
    throw new Error(`--parse-metadata needs FROM:TO, got ${rule}`);
  }

  const from = unescapeColon(parts[0]!);
  const to = unescapeColon(parts.slice(1).join(":"));
  const source = from.includes("%(") ? renderTemplate({
    template: from,
    fields
  }) : String(fields[from] ?? "");
  if (NAMED_GROUP_MARKER.test(to)) {
    const groups = source.match(toJavaScriptRegex(to))?.groups ?? {};
    Object.assign(fields, groups);
    return;
  }

  const target = to.match(SINGLE_FIELD_PATTERN)?.[1] ?? to;
  fields[target] = source;
}

export function applyMetadataRules({ fields, options }: MetadataRulesRequest) {
  for (const rule of options.parseMetadata) {
    applyParseRule({
      fields,
      rule
    });
  }

  for (const { fields: fieldPatterns, pattern, replacement } of options.replaceInMetadata) {
    const regex = new RegExp(pattern, "g");
    const replacementText = replacement.replace(BACKREFERENCE_PATTERN, "$$$1");
    for (const name in fields) {
      const isTargeted = fieldPatterns.some(fieldPattern => new RegExp(`^(?:${fieldPattern})$`).test(name));
      const value = fields[name];
      if (isTargeted && typeof value === "string") {
        fields[name] = value.replace(regex, replacementText);
      }
    }
  }
}

function replaceControlCharacters(text: string) {
  return Array.from(text, character => (character.charCodeAt(0) < FIRST_PRINTABLE_CODE ? "_" : character)).join("");
}

function sanitizeSegment({ text: segment, options }: SanitizeRequest) {
  const cleaned = replaceControlCharacters(segment.replace(ILLEGAL_FILENAME_PATTERN, "_"))
    .replace(TRAILING_DOTS_PATTERN, "")
    .replace(LEADING_DOTS_PATTERN, "")
    .trim();
  const restricted = options.isRestrictFilenames ? cleaned.replace(RESTRICTED_FILENAME_PATTERN, "_") : cleaned;
  return restricted.slice(0, options.trimFilenames ?? MAX_SEGMENT_LENGTH);
}

function sanitizePath({ text: path, options }: SanitizeRequest) {
  if (ABSOLUTE_PATH_PATTERN.test(path)) {
    throw new Error("Paths must be relative, files go inside your Downloads folder");
  }

  return path
    .split("/")
    .map(segment => sanitizeSegment({
      text: segment,
      options
    }))
    .filter(segment => segment && segment !== "..")
    .join("/");
}

function replaceExtension({ name, extension }: ExtensionRequest) {
  return EXTENSION_PATTERN.test(name) ? name.replace(EXTENSION_PATTERN, `.${extension}`) : `${name}.${extension}`;
}

export function buildSavePath({ options, type, fields, extension }: SavePathRequest) {
  const template = options.outputs[type] ?? options.outputs.default!;
  const isExtensionAware = template.includes("%(ext)s");
  const rendered = renderTemplate({
    template,
    fields: {
      ...fields,
      ext: extension
    },
    isPath: true
  });
  const hasExtension = isExtensionAware || rendered.endsWith(`.${extension}`);
  const named = hasExtension ? rendered : replaceExtension({
    name: rendered,
    extension
  });
  const directory = options.paths[type] ?? options.paths.home;
  const full = directory ? `${directory}/${named}` : named;
  return sanitizePath({
    text: full,
    options
  });
}

export function formatByteSize(bytes: number) {
  const units = ["B", "KiB", "MiB", "GiB"];
  const exponent = Math.min(Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(BYTE_UNIT)), units.length - 1);
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(bytes / BYTE_UNIT ** exponent)}${units[exponent]}`;
}

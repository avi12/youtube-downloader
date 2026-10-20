import { URL_TOKEN } from "@/lib/command";
import { z } from "zod";

const STORAGE_KEY = "presetLibrary";
const EXPORT_VERSION = 1;
const VARIABLE_PLACEHOLDER_PATTERN = /%([A-Za-z_]\w*)%/g;
export const CURRENT_TIME_VARIABLE = "current_time";
export const TIME_PATTERN = /^(?:\d+:)?[0-5]?\d:[0-5]\d(?:\.\d+)?$|^\d+(?:\.\d+)?$/;

const variableBase = {
  name: z.string().regex(/^[A-Za-z_]\w*$/, "Use letters, digits and underscores"),
  label: z.string()
};

export const variableSchema = z.discriminatedUnion("type", [
  z.object({
    ...variableBase,
    type: z.literal("number"),
    defaultValue: z.number(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional()
  }),
  z.object({
    ...variableBase,
    type: z.literal("time"),
    defaultValue: z.string()
  }),
  z.object({
    ...variableBase,
    type: z.literal("text"),
    defaultValue: z.string()
  }),
  z.object({
    ...variableBase,
    type: z.literal("list"),
    defaultValue: z.string(),
    options: z.array(
      z.object({
        label: z.string(),
        value: z.string()
      })
    ).min(1)
  })
]);

export const presetSchema = z.object({
  id: z.string(),
  label: z.string(),
  command: z.string(),
  ffmpegCommand: z.string().optional(),
  variables: z.array(variableSchema).default([])
});

const libraryStateSchema = z.object({
  custom: z.array(presetSchema),
  shownIds: z.array(z.string()).optional(),
  defaultId: z.string().optional(),
  checkedIds: z.array(z.string()).optional()
});

const exportFileSchema = libraryStateSchema.extend({ version: z.literal(EXPORT_VERSION) });

export type Variable = z.infer<typeof variableSchema>;
export type VariableType = Variable["type"];
export type Preset = z.infer<typeof presetSchema>;
export type LibraryState = z.infer<typeof libraryStateSchema>;

export const VARIABLE_TYPES = variableSchema.options.map(option => option.shape.type.value);

const qualityOptions = ["360", "480", "720", "1080", "1440", "2160"].map(value => ({
  label: `${value}p`,
  value
}));
const audioFormatOptions = ["mp3", "m4a", "opus", "flac", "wav"].map(value => ({
  label: value.toUpperCase(),
  value
}));

export const BUILT_IN_PRESETS: Preset[] = [
  {
    id: "best",
    label: "Best video + audio",
    command: `yt-dlp ${URL_TOKEN}`,
    variables: []
  },
  {
    id: "max-quality",
    label: "Limit the quality",
    command: `yt-dlp -f "bv*[height<=%quality%]+ba/b[height<=%quality%]" ${URL_TOKEN}`,
    variables: [{
      type: "list",
      name: "quality",
      label: "Up to",
      defaultValue: "720",
      options: qualityOptions
    }]
  },
  {
    id: "audio",
    label: "Audio only with cover",
    command: `yt-dlp -x --audio-format %format% --embed-thumbnail --embed-metadata ${URL_TOKEN}`,
    variables: [{
      type: "list",
      name: "format",
      label: "Format",
      defaultValue: "mp3",
      options: audioFormatOptions
    }]
  },
  {
    id: "captions",
    label: "Captions only (SRT)",
    command: `yt-dlp --skip-download --write-subs --write-auto-subs --sub-langs %languages% --convert-subs srt ${URL_TOKEN}`,
    variables: [{
      type: "text",
      name: "languages",
      label: "Languages",
      defaultValue: "en"
    }]
  },
  {
    id: "subtitled",
    label: "Video with subtitles and chapters",
    command: `yt-dlp --embed-subs --sub-langs en --embed-chapters --embed-metadata ${URL_TOKEN}`,
    variables: []
  },
  {
    id: "clip",
    label: "Clip",
    command: `yt-dlp --download-sections "*%start%-%end%" ${URL_TOKEN}`,
    variables: [
      {
        type: "time",
        name: "start",
        label: "From",
        defaultValue: "00:00:10"
      },
      {
        type: "time",
        name: "end",
        label: "To",
        defaultValue: "00:00:20"
      }
    ]
  },
  {
    id: "playlist-mp3",
    label: "Whole playlist as MP3",
    command: `yt-dlp -x --audio-format mp3 -o "%(playlist)s/%(playlist_index)02d - %(title)s.%(ext)s" ${URL_TOKEN}`,
    variables: []
  },
  {
    id: "thumbnail",
    label: "Thumbnail only",
    command: `yt-dlp --skip-download --write-thumbnail ${URL_TOKEN}`,
    variables: []
  },
  {
    id: "snapshot",
    label: "Snapshot (PNG)",
    command: `yt-dlp -f "bv*[height<=720][vcodec^=avc1]" ${URL_TOKEN}`,
    ffmpegCommand: "-ss %at% -i {input1} -frames:v %frames% snapshot.png",
    variables: [
      {
        type: "time",
        name: "at",
        label: "At",
        defaultValue: "00:00:05"
      },
      {
        type: "number",
        name: "frames",
        label: "Frames",
        defaultValue: 1,
        min: 1,
        max: 100,
        step: 1
      }
    ]
  },
  {
    id: "frames",
    label: "Image sequence (PNG)",
    command: `yt-dlp -f "bv*[height<=720][vcodec^=avc1]" ${URL_TOKEN}`,
    ffmpegCommand: "-ss %at% -t %seconds% -i {input1} -vf fps=%fps% frame%03d.png",
    variables: [
      {
        type: "time",
        name: "at",
        label: "From",
        defaultValue: "00:00:05"
      },
      {
        type: "number",
        name: "seconds",
        label: "Seconds",
        defaultValue: 3,
        min: 1,
        max: 60,
        step: 1
      },
      {
        type: "number",
        name: "fps",
        label: "Per second",
        defaultValue: 1,
        min: 1,
        max: 30,
        step: 1
      }
    ]
  },
  {
    id: "formats",
    label: "List formats",
    command: `yt-dlp -F ${URL_TOKEN}`,
    variables: []
  }
];

export const DEFAULT_SHOWN_IDS = ["best", "max-quality", "audio"];

export function isBuiltInPreset(id: string) {
  return BUILT_IN_PRESETS.some(preset => preset.id === id);
}

export function findPreset(state: LibraryState, id: string) {
  return [...BUILT_IN_PRESETS, ...state.custom].find(preset => preset.id === id);
}

export function listShownPresets(state: LibraryState) {
  return (state.shownIds ?? DEFAULT_SHOWN_IDS).flatMap(id => findPreset(state, id) ?? []);
}

type MoveRequest = {
  ids: string[];
  movedId: string;
  targetId: string;
};
type MergeRequest = {
  current: LibraryState;
  imported: LibraryState;
};
type FillRequest = {
  text: string;
  variables: Variable[];
  values: Record<string, string>;
  builtInValues?: Record<string, string>;
};
type VariableReference = {
  texts: (string | undefined)[];
  name: string;
};

export function moveBefore({ ids, movedId, targetId }: MoveRequest) {
  if (movedId === targetId) {
    return ids;
  }

  const without = ids.filter(id => id !== movedId);
  const targetIndex = without.indexOf(targetId);
  return [...without.slice(0, targetIndex), movedId, ...without.slice(targetIndex)];
}

export function listHiddenPresets(state: LibraryState) {
  const shownIds = new Set(state.shownIds ?? DEFAULT_SHOWN_IDS);
  return [...BUILT_IN_PRESETS, ...state.custom].filter(preset => !shownIds.has(preset.id));
}

export function loadLibraryState(): LibraryState {
  const stored = localStorage.getItem(STORAGE_KEY);
  const parsed = z.string().transform(text => JSON.parse(text)).pipe(libraryStateSchema).safeParse(stored);
  return parsed.success ? parsed.data : { custom: [] };
}

export function storeLibraryState(state: LibraryState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function serializeLibraryState(state: LibraryState) {
  return JSON.stringify({
    version: EXPORT_VERSION,
    ...state
  }, null, 2);
}

export function parseLibraryFile(text: string): LibraryState {
  const parsed = z.string().transform(content => JSON.parse(content)).pipe(exportFileSchema).safeParse(text);
  if (!parsed.success) {
    throw new Error(`That file isn't a preset export: ${z.prettifyError(parsed.error)}`);
  }

  const { custom, shownIds, defaultId, checkedIds } = parsed.data;
  return {
    custom,
    shownIds,
    defaultId,
    checkedIds
  };
}

export function mergeLibraryState({ current, imported }: MergeRequest): LibraryState {
  const importedIds = new Set(imported.custom.map(preset => preset.id));
  return {
    custom: [...current.custom.filter(preset => !importedIds.has(preset.id)), ...imported.custom],
    shownIds: imported.shownIds ?? current.shownIds,
    defaultId: imported.defaultId ?? current.defaultId,
    checkedIds: imported.checkedIds ?? current.checkedIds
  };
}

export function createBlankPreset(): Preset {
  return {
    id: crypto.randomUUID(),
    label: "New preset",
    command: `yt-dlp ${URL_TOKEN}`,
    variables: []
  };
}

export function defaultValues(variables: Variable[]) {
  return Object.fromEntries(variables.map(variable => [variable.name, String(variable.defaultValue)]));
}

function buildValueSchema(variable: Variable) {
  if (variable.type === "number") {
    const base = z.coerce.number();
    const withMin = variable.min === undefined ? base : base.min(variable.min);
    return variable.max === undefined ? withMin : withMin.max(variable.max);
  }

  if (variable.type === "time") {
    return z.string().regex(TIME_PATTERN, "Use a time like 00:01:30");
  }

  if (variable.type === "list") {
    return z.enum(variable.options.map(option => option.value));
  }

  return z.string();
}

export function referencesVariable({ texts, name }: VariableReference) {
  return texts.some(text => text?.includes(`%${name}%`));
}

export function fillVariables({ text, variables, values, builtInValues = {} }: FillRequest) {
  const variableByName = new Map(variables.map(variable => [variable.name, variable]));
  return text.replace(VARIABLE_PLACEHOLDER_PATTERN, (_match, name: string) => {
    const variable = variableByName.get(name);
    const builtInValue = builtInValues[name];
    if (!variable && builtInValue !== undefined) {
      return builtInValue;
    }

    if (!variable) {
      throw new Error(`%${name}% isn't defined as a variable in this preset`);
    }

    const parsed = buildValueSchema(variable).safeParse(values[name] ?? "");
    if (!parsed.success) {
      throw new Error(`${variable.label}: ${parsed.error.issues[0]?.message ?? "invalid value"}`);
    }

    return String(parsed.data);
  });
}

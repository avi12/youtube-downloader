import { z } from "zod";
import { PRESETS } from "@/lib/command";

const STORAGE_KEY = "savedPresets";

const presetSchema = z.object({
  label: z.string(),
  command: z.string(),
  ffmpegCommand: z.string().optional()
});

export type Preset = z.infer<typeof presetSchema>;

export const BUILT_IN_PRESETS: Preset[] = PRESETS;

export function loadSavedPresets() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return [];
  }

  const parsed = z.string().transform(text => JSON.parse(text)).pipe(z.array(presetSchema)).safeParse(stored);
  return parsed.success ? parsed.data : [];
}

export function storeSavedPresets(presets: Preset[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export function upsertPreset(presets: Preset[], preset: Preset) {
  const isExisting = presets.some(saved => saved.label === preset.label);
  return isExisting ? presets.map(saved => (saved.label === preset.label ? preset : saved)) : [...presets, preset];
}

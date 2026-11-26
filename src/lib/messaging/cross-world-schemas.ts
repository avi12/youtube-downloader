// Payloads that cross worlds, where page scripts can forge anything
import { z } from "@/lib/zod";
import { createGuard } from "@/lib/zod-guard";
import type { Prettify } from "@/types";

const audioTrackChangedSchema = z.looseObject({ trackId: z.string() });

const captionTrackChangedSchema = z.looseObject({
  languageCode: z.string(),
  vssId: z.string()
});

const buttonClickSchema = z.looseObject({ buttonId: z.string() });

export type AudioTrackChangedPayload = Prettify<z.infer<typeof audioTrackChangedSchema>>;
export type CaptionTrackChangedPayload = Prettify<z.infer<typeof captionTrackChangedSchema>>;
export type ButtonClickPayload = Prettify<z.infer<typeof buttonClickSchema>>;

export const isAudioTrackChangedPayload = createGuard(audioTrackChangedSchema);
export const isCaptionTrackChangedPayload = createGuard(captionTrackChangedSchema);
export const isButtonClickPayload = createGuard(buttonClickSchema);

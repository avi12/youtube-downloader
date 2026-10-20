import { z } from "zod";

export const TASK_EVENT = "ffmpeg-lite-task";
export const RESULT_EVENT_PREFIX = "ffmpeg-lite-result-";

export const pageTaskSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("time") }),
  z.object({
    kind: z.enum(["playlist", "chapters"]),
    id: z.string()
  }),
  z.object({
    kind: z.literal("player"),
    id: z.string(),
    withCaptions: z.boolean().optional()
  })
]);
export type PageTask = z.infer<typeof pageTaskSchema>;

export const taskRequestSchema = z.object({
  id: z.string(),
  task: pageTaskSchema
});
export type TaskRequest = z.infer<typeof taskRequestSchema>;

export type TabTask = {
  tabId: number | undefined;
  task: PageTask;
};

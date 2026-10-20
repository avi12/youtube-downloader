import { z } from "zod";
import { runPageTaskInMainWorld } from "@/lib/page-bridge";
import { pageResultSchema } from "@/lib/schemas";
import type { PageTask } from "@/lib/page-events";

export type { PlaylistEntry, PlaylistListing, RawChapter } from "@/lib/page-task";

async function runTask(tabId: number | undefined, task: PageTask) {
  if (tabId === undefined) {
    throw new Error("Open the popup on a YouTube tab for playlists and chapters");
  }

  const parsed = pageResultSchema.safeParse(await runPageTaskInMainWorld(tabId, task));
  if (!parsed.success) {
    throw new Error(`Couldn't read the YouTube page: ${z.prettifyError(parsed.error)}`);
  }

  if (parsed.data.error) {
    throw new Error(parsed.data.error);
  }

  return parsed.data;
}

export async function fetchPlaylist(tabId: number | undefined, playlistId: string) {
  const { playlist } = await runTask(tabId, { kind: "playlist", id: playlistId });
  return playlist!;
}

export async function fetchChapters(tabId: number | undefined, videoId: string) {
  const { chapters } = await runTask(tabId, { kind: "chapters", id: videoId });
  return chapters ?? [];
}

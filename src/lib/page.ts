import { z } from "zod";
import { runPageTaskInMainWorld } from "@/lib/page-bridge";
import { pageResultSchema } from "@/lib/schemas";
import type { TabTask } from "@/lib/page-events";

export type { PlaylistEntry, PlaylistListing, RawChapter } from "@/lib/page-task";

type TabVideo = { tabId: number | undefined; videoId: string };
type TabPlaylist = { tabId: number | undefined; playlistId: string };
export type TabPlayer = TabVideo & { withCaptions: boolean };

async function runTask({ tabId, task }: TabTask) {
  if (tabId === undefined) {
    throw new Error("Open the popup on a YouTube tab for playlists and chapters");
  }

  const parsed = pageResultSchema.safeParse(await runPageTaskInMainWorld({ tabId, task }));
  if (!parsed.success) {
    throw new Error(`Couldn't read the YouTube page: ${z.prettifyError(parsed.error)}`);
  }

  if (parsed.data.error) {
    throw new Error(parsed.data.error);
  }

  return parsed.data;
}

export async function fetchPlaylist({ tabId, playlistId }: TabPlaylist) {
  const { playlist } = await runTask({ tabId, task: { kind: "playlist", id: playlistId } });
  return playlist!;
}

export async function fetchPlayer({ tabId, videoId, withCaptions }: TabPlayer) {
  const { player } = await runTask({ tabId, task: { kind: "player", id: videoId, withCaptions } });
  return player!;
}

export async function fetchChapters({ tabId, videoId }: TabVideo) {
  const { chapters } = await runTask({ tabId, task: { kind: "chapters", id: videoId } });
  return chapters ?? [];
}

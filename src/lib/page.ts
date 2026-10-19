import { z } from "zod";
import { pageResultSchema } from "@/lib/schemas";
import type { PageResult } from "@/lib/schemas";

export type PlaylistListing = NonNullable<PageResult["playlist"]>;
export type PlaylistEntry = PlaylistListing["entries"][number];
export type RawChapter = NonNullable<PageResult["chapters"]>[number];

type PageTask = { kind: "playlist" | "chapters"; id: string };

async function runInsideYouTubePage(task: PageTask): Promise<PageResult> {
  const MAX_PAGES = 200;
  const MILLISECONDS_PER_SECOND = 1000;
  const SAPISID_PATTERN = /(?:^|; )(?:__Secure-3PAPISID|SAPISID)=([^;]+)/;
  const BYTE_RADIX = 16;
  const BYTE_WIDTH = 2;
  const ytcfg: { get: (key: string) => unknown } | undefined = Reflect.get(window, "ytcfg");
  const context = ytcfg?.get("INNERTUBE_CONTEXT");
  if (!context) {
    return { error: "Open a YouTube page first" };
  }

  async function buildHeaders() {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Youtube-Client-Name": String(ytcfg?.get("INNERTUBE_CONTEXT_CLIENT_NAME")),
      "X-Youtube-Client-Version": String(ytcfg?.get("INNERTUBE_CONTEXT_CLIENT_VERSION"))
    };
    const sapisid = document.cookie.match(SAPISID_PATTERN)?.[1];
    if (!sapisid) {
      return headers;
    }

    const timestamp = Math.floor(Date.now() / MILLISECONDS_PER_SECOND);
    const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`${timestamp} ${sapisid} ${location.origin}`));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(BYTE_RADIX).padStart(BYTE_WIDTH, "0")).join("");
    return { ...headers, Authorization: `SAPISIDHASH ${timestamp}_${hash}`, "X-Origin": location.origin, "X-Goog-AuthUser": "0" };
  }

  async function post(endpoint: string, body: object) {
    const response = await fetch(`/youtubei/v1/${endpoint}?prettyPrint=false`, {
      method: "POST",
      credentials: "include",
      headers: await buildHeaders(),
      body: JSON.stringify({ context, ...body })
    });
    if (!response.ok) {
      throw new Error(`YouTube answered ${response.status}`);
    }

    return response.json();
  }

  type JsonRecord = Record<string, unknown>;

  function isRecord(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function* walk(node: unknown): Generator<JsonRecord> {
    if (typeof node !== "object" || node === null) {
      return;
    }

    if (isRecord(node)) {
      yield node;
    }

    for (const child of Object.values(node)) {
      yield* walk(child);
    }
  }

  function child(node: unknown, key: string) {
    return isRecord(node) ? node[key] : undefined;
  }

  function readText(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }

    const simpleText = child(value, "simpleText");
    const content = child(value, "content");
    const runs = child(value, "runs");
    if (typeof simpleText === "string") {
      return simpleText;
    }

    if (typeof content === "string") {
      return content;
    }

    return Array.isArray(runs) ? runs.map(run => String(child(run, "text") ?? "")).join("") : "";
  }

  async function listPlaylist(listId: string): Promise<PlaylistListing> {
    const entries: PlaylistEntry[] = [];
    const seen = new Set<string>();
    let playlistTitle = "";
    let response = await post("browse", { browseId: `VL${listId}` });
    for (let page = 0; page < MAX_PAGES; page++) {
      playlistTitle ||= readText(child(child(child(response, "metadata"), "playlistMetadataRenderer"), "title"));
      let token = "";
      for (const node of walk(response)) {
        const renderer = child(node, "playlistVideoRenderer");
        const isLockupVideo = node.contentType === "LOCKUP_CONTENT_TYPE_VIDEO";
        const videoId = child(renderer, "videoId") ?? (isLockupVideo ? node.contentId : undefined);
        if (typeof videoId === "string" && !seen.has(videoId)) {
          seen.add(videoId);
          const lockupTitle = child(child(node, "metadata"), "lockupMetadataViewModel");
          entries.push({ videoId, title: readText(child(renderer, "title") ?? child(lockupTitle, "title")) });
        }

        const continuationToken = child(child(node, "continuationCommand"), "token");
        token ||= typeof continuationToken === "string" ? continuationToken : "";
      }

      if (!token) {
        break;
      }

      response = await post("browse", { continuation: token });
    }

    return { title: playlistTitle, entries };
  }

  async function listChapters(videoId: string): Promise<RawChapter[]> {
    const response = await post("next", { videoId });
    const chapters = new Map<number, string>();
    for (const node of walk(response)) {
      const renderer = child(node, "chapterRenderer");
      const startMillis = child(renderer, "timeRangeStartMillis");
      if (typeof startMillis === "number") {
        chapters.set(startMillis / MILLISECONDS_PER_SECOND, readText(child(renderer, "title")));
      }

      const marker = child(node, "macroMarkersListItemRenderer");
      const startSeconds = child(child(child(marker, "onTap"), "watchEndpoint"), "startTimeSeconds");
      if (typeof startSeconds === "number") {
        chapters.set(startSeconds, readText(child(marker, "title")));
      }
    }

    return [...chapters].sort(([first], [second]) => first - second).map(([start, title]) => ({ title, start }));
  }

  try {
    if (task.kind === "playlist") {
      return { playlist: await listPlaylist(task.id) };
    }

    return { chapters: await listChapters(task.id) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function runTask(tabId: number | undefined, task: PageTask) {
  if (tabId === undefined) {
    throw new Error("Open the popup on a YouTube tab for playlists and chapters");
  }

  const [injection] = await browser.scripting.executeScript({ target: { tabId }, world: "MAIN", func: runInsideYouTubePage, args: [task] });
  const parsed = pageResultSchema.safeParse(injection?.result);
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

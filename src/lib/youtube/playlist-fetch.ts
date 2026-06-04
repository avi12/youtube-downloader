import {
  browseContinuationResponseSchema,
  playlistContinuationEntrySchema,
  playlistVideoEntrySchema,
  ytInitialDataPlaylistSchema,
  type PlaylistContinuationEntry,
  type PlaylistVideoEntry,
  type YtInitialDataPlaylist
} from "./schemas";
import type { Prettify } from "@/types";

const PLAYLIST_URL_PREFIX = "https://www.youtube.com/playlist?list=";
const BROWSE_URL = "https://www.youtube.com/youtubei/v1/browse?prettyPrint=false";
const INITIAL_DATA_PATTERN = /var ytInitialData\s*=\s*(.+?);\s*(?:var\s|<\/script>)/s;
const CLIENT_VERSION_PATTERN = /"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/;
const CLIENT_NAME_PATTERN = /"INNERTUBE_CONTEXT_CLIENT_NAME":(\d+)/;
const VISITOR_DATA_PATTERN = /"visitorData":"([^"]+)"/;
const MAX_CONTINUATION_PAGES = 50;
const HEADER_CONTENT_TYPE = "Content-Type";
const HEADER_GOOG_VISITOR_ID = "X-Goog-Visitor-Id";
const CONTENT_TYPE_JSON = "application/json";

type InnertubeMeta = Prettify<{
  clientName: string;
  clientVersion: string;
  visitorData: string;
}>;

export type PlaylistContents = Prettify<{
  videoIds: string[];
  title: string;
  owner: string;
}>;

function isPlaylistVideoEntry(entry: unknown): entry is PlaylistVideoEntry {
  return playlistVideoEntrySchema.safeParse(entry).success;
}

function isContinuationEntry(entry: unknown): entry is PlaylistContinuationEntry {
  return playlistContinuationEntrySchema.safeParse(entry).success;
}

type ParsedEntries = Prettify<{
  videoIds: string[];
  continuationToken: string | null;
}>;

function parseEntries(entries: readonly unknown[]): ParsedEntries {
  const videoIds: string[] = [];
  let continuationToken: string | null = null;
  for (const entry of entries) {
    if (isPlaylistVideoEntry(entry)) {
      const videoId = entry.playlistVideoRenderer.videoId;
      if (videoId) {
        videoIds.push(videoId);
      }

      continue;
    }

    if (isContinuationEntry(entry)) {
      const token = entry.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token;
      if (token) {
        continuationToken = token;
      }
    }
  }
  return {
    videoIds,
    continuationToken
  };
}

function extractInitialPlaylistEntries(data: YtInitialDataPlaylist) {
  const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs ?? [];
  for (const tab of tabs) {
    const sections = tab.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
    for (const section of sections) {
      const items = section.itemSectionRenderer?.contents ?? [];
      for (const item of items) {
        const entries = item.playlistVideoListRenderer?.contents;
        if (entries?.length) {
          return entries;
        }
      }
    }
  }
  return [];
}

function extractInnertubeMeta(html: string): InnertubeMeta {
  const [, clientVersion = "2.20240101.00.00"] = html.match(CLIENT_VERSION_PATTERN) ?? [];
  const [, clientName = "1"] = html.match(CLIENT_NAME_PATTERN) ?? [];
  const [, visitorData = ""] = html.match(VISITOR_DATA_PATTERN) ?? [];
  return {
    clientName,
    clientVersion,
    visitorData
  };
}

async function fetchContinuationPage({ token, meta }: {
  token: string;
  meta: InnertubeMeta;
}) {
  const response = await fetch(BROWSE_URL, {
    method: "POST",
    credentials: "include",
    headers: {
      [HEADER_CONTENT_TYPE]: CONTENT_TYPE_JSON,
      [HEADER_GOOG_VISITOR_ID]: meta.visitorData
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: meta.clientName === "1" ? "WEB" : meta.clientName,
          clientVersion: meta.clientVersion,
          visitorData: meta.visitorData
        }
      },
      continuation: token
    })
  });
  if (!response.ok) {
    const empty: ParsedEntries = {
      videoIds: [],
      continuationToken: null
    };
    return empty;
  }

  const rawJson: unknown = await response.json();
  const parsed = browseContinuationResponseSchema.safeParse(rawJson);
  if (!parsed.success) {
    return {
      videoIds: [],
      continuationToken: null
    };
  }

  const actions = parsed.data.onResponseReceivedActions ?? [];
  const continuationItems = actions.flatMap(action => action.appendContinuationItemsAction?.continuationItems ?? []);
  return parseEntries(continuationItems);
}

export async function fetchPlaylistContents(playlistId: string): Promise<PlaylistContents | null> {
  const response = await fetch(`${PLAYLIST_URL_PREFIX}${playlistId}`, { credentials: "include" });
  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  const [, jsonText = ""] = html.match(INITIAL_DATA_PATTERN) ?? [];
  if (!jsonText) {
    return null;
  }

  let data: YtInitialDataPlaylist;
  try {
    const parsed = ytInitialDataPlaylistSchema.safeParse(JSON.parse(jsonText));
    if (!parsed.success) {
      return null;
    }

    data = parsed.data;
  } catch {
    return null;
  }
  const initialEntries = extractInitialPlaylistEntries(data);
  const initial = parseEntries(initialEntries);
  const videoIds = [...initial.videoIds];

  const meta = extractInnertubeMeta(html);
  let token = initial.continuationToken;
  let page = 0;
  while (token && page < MAX_CONTINUATION_PAGES) {
    const next = await fetchContinuationPage({
      token,
      meta
    });
    videoIds.push(...next.videoIds);
    token = next.continuationToken;
    page++;
  }

  const headerRenderer = data.header?.playlistHeaderRenderer;
  const metadataRenderer = data.metadata?.playlistMetadataRenderer;
  return {
    videoIds,
    title: headerRenderer?.title?.simpleText ?? metadataRenderer?.title ?? "",
    owner: headerRenderer?.ownerText?.runs?.[0]?.text ?? ""
  };
}

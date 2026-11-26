import { type InnertubeBrowseRequest, InnertubeClientName } from "@/lib/youtube/innertube";
import { z } from "@/lib/zod";
import { createGuard } from "@/lib/zod-guard";
import type { Prettify } from "@/types";

const YT_MUSIC_BROWSE_URL = "https://music.youtube.com/youtubei/v1/browse?prettyPrint=false";
const YT_MUSIC_MOODS_AND_GENRES_BROWSE_ID = "FEmusic_moods_and_genres";
const CONTENT_TYPE_JSON = "application/json";

const genreItemSchema = z.object({
  musicNavigationButtonRenderer: z.object({
    buttonText: z.object({
      runs: z.array(z.object({ text: z.string().optional() })).optional()
    }).optional()
  }).optional()
});

const genreSectionSchema = z.object({
  gridRenderer: z.object({ items: z.array(genreItemSchema).optional() }).optional()
});

const genreTabSchema = z.object({
  tabRenderer: z.object({
    content: z.object({
      sectionListRenderer: z.object({ contents: z.array(genreSectionSchema).optional() }).optional()
    }).optional()
  }).optional()
});

const isMoodsAndGenresResponse = createGuard(
  z.object({
    contents: z.object({
      singleColumnBrowseResultsRenderer: z.object({ tabs: z.array(genreTabSchema).optional() }).optional()
    }).optional()
  })
);

const YT_MUSIC_CLIENT_VERSION = "1.20260408.01.00";
let cachedYouTubeMusicGenres: Set<string> | null = null;

export async function fetchYouTubeMusicGenres() {
  if (cachedYouTubeMusicGenres) {
    return cachedYouTubeMusicGenres;
  }

  try {
    const response = await fetch(YT_MUSIC_BROWSE_URL, {
      method: "POST",
      headers: {
        "Content-Type": CONTENT_TYPE_JSON
      },
      body: JSON.stringify({
        browseId: YT_MUSIC_MOODS_AND_GENRES_BROWSE_ID,
        context: {
          client: {
            clientName: InnertubeClientName.WebRemix,
            clientVersion: YT_MUSIC_CLIENT_VERSION
          }
        }
      } satisfies InnertubeBrowseRequest)
    });

    const data: unknown = await response.json();
    if (!isMoodsAndGenresResponse(data)) {
      return new Set<string>();
    }

    const [firstTab] = data.contents?.singleColumnBrowseResultsRenderer?.tabs ?? [];
    const sections = firstTab?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];

    const genres = new Set<string>();
    const items = sections.flatMap(section => section.gridRenderer?.items ?? []);
    for (const item of items) {
      const title = item.musicNavigationButtonRenderer?.buttonText?.runs?.[0]?.text;
      if (title) {
        genres.add(title.toLowerCase());
      }
    }

    cachedYouTubeMusicGenres = genres;
    return genres;
  } catch {
    return new Set<string>();
  }
}

type ExtractGenresFromKeywordsParams = Prettify<{
  keywords: string[];
  genreSet: Set<string>;
}>;
export function extractGenresFromKeywords({ keywords, genreSet }: ExtractGenresFromKeywordsParams) {
  const matched = new Set<string>();
  for (const keyword of keywords) {
    const normalized = keyword.toLowerCase().trim();
    const isMatchedGenre = genreSet.has(normalized);
    if (isMatchedGenre) {
      matched.add(keyword.trim());
    }
  }

  return [...matched];
}

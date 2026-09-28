import { InnertubeClientName, type InnertubeBrowseRequest } from "@/lib/youtube/innertube";
import { z } from "@/lib/zod";
import type { Prettify } from "@/types";

const YT_MUSIC_BROWSE_URL = "https://music.youtube.com/youtubei/v1/browse?prettyPrint=false";
const YT_MUSIC_MOODS_AND_GENRES_BROWSE_ID = "FEmusic_moods_and_genres";
const CONTENT_TYPE_JSON = "application/json";

type MoodsAndGenresResponse = Prettify<{
  contents?: {
    singleColumnBrowseResultsRenderer?: {
      tabs?: Array<{
        tabRenderer?: {
          content?: {
            sectionListRenderer?: {
              contents?: Array<{
                gridRenderer?: {
                  items?: Array<{
                    musicNavigationButtonRenderer?: {
                      buttonText?: {
                        runs?: Array<{ text: string }>;
                      };
                    };
                  }>;
                };
              }>;
            };
          };
        };
      }>;
    };
  };
}>;

const moodsAndGenresResponseShapeSchema = z.looseObject({});
const moodsAndGenresResponseSchema = z.custom<MoodsAndGenresResponse>(
  value => moodsAndGenresResponseShapeSchema.safeParse(value).success
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

    const data = moodsAndGenresResponseSchema.parse(await response.json());
    const sections = data.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]
      ?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];

    const genres = new Set<string>();
    for (const section of sections) {
      for (const item of section.gridRenderer?.items ?? []) {
        const title = item.musicNavigationButtonRenderer?.buttonText?.runs?.[0]?.text;
        if (title) {
          genres.add(title.toLowerCase());
        }
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

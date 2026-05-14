import { InnertubeClientName, type InnertubeBrowseRequest } from "@/lib/youtube/innertube";

interface MoodsAndGenresResponse {
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
}

const YT_MUSIC_CLIENT_VERSION = "1.20260408.01.00";
let cachedYouTubeMusicGenres: Set<string> | null = null;

export async function fetchYouTubeMusicGenres() {
  if (cachedYouTubeMusicGenres) {
    return cachedYouTubeMusicGenres;
  }

  try {
    const browseRequest: InnertubeBrowseRequest = {
      browseId: "FEmusic_moods_and_genres",
      context: {
        client: {
          clientName: InnertubeClientName.WebRemix,
          clientVersion: YT_MUSIC_CLIENT_VERSION
        }
      }
    };
    const response = await fetch("https://music.youtube.com/youtubei/v1/browse?prettyPrint=false", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(browseRequest)
    });

    const data: MoodsAndGenresResponse = await response.json();
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

export function extractGenresFromKeywords({ keywords, genreSet }: {
  keywords: string[];
  genreSet: Set<string>;
}) {
  const matched = new Set<string>();
  for (const keyword of keywords) {
    const normalized = keyword.toLowerCase().trim();
    if (genreSet.has(normalized)) {
      matched.add(keyword.trim());
    }
  }

  return [...matched];
}

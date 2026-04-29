let cachedYouTubeMusicGenres: Set<string> | null = null;

async function fetchYouTubeMusicGenres() {
  if (cachedYouTubeMusicGenres) {
    return cachedYouTubeMusicGenres;
  }

  try {
    const response = await fetch("https://music.youtube.com/youtubei/v1/browse?prettyPrint=false", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        browseId: "FEmusic_moods_and_genres",
        context: {
          client: {
            clientName: "WEB_REMIX",
            clientVersion: "1.20260408.01.00"
          }
        }
      })
    });

    const data = await response.json();
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

function extractGenresFromKeywords({ keywords, genreSet }: {
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

const videoTitleSuffixPattern = /\s*[[(](?:official\s+(?:music\s+)?video|(?:official\s+)?lyric(?:s)?\s*(?:video)?|(?:official\s+)?audio|4k\s*remaster(?:ed)?|remaster(?:ed)?|hd|hq|visualizer|clip\s+officiel|video\s*oficial)[)\]]\s*/gi;
const featuringPattern = /\s+(?:ft\.?|feat\.?|featuring)\s+(.+)$/i;

export function parseMusicTitle(title: string) {
  const cleaned = title.replaceAll(videoTitleSuffixPattern, "").trim();

  const iSeparator = cleaned.search(/\s[-–]\s/);
  if (iSeparator === -1) {
    return {
      mainArtist: "",
      fullArtist: "",
      songTitle: cleaned
    };
  }

  const mainArtist = cleaned.slice(0, iSeparator).trim();
  const afterSeparator = cleaned.slice(iSeparator + 3).trim();

  const featMatch = afterSeparator.match(featuringPattern);
  const songTitle = afterSeparator.replace(featuringPattern, "").trim();
  const fullArtist = featMatch
    ? `${mainArtist} feat. ${featMatch[1].trim()}`
    : mainArtist;

  return {
    mainArtist,
    fullArtist,
    songTitle
  };
}

export function parseDescriptionMetadata(description: string) {
  if (!description.startsWith("Provided to YouTube")) {
    return {
      songTitle: undefined,
      artist: undefined,
      mainArtist: undefined,
      album: undefined
    };
  }

  const lines = description.split("\n").filter(line => line.trim());
  const titleArtistLine = lines[1] ?? "";
  const parts = titleArtistLine.split(" · ");
  const songTitle = parts[0]?.trim() || undefined;
  const artists = parts.slice(1);
  const mainArtist = artists[0]?.trim() || undefined;
  const artist = artists.join(", ") || undefined;
  const album = lines[2]?.trim() || undefined;

  return {
    songTitle,
    artist,
    mainArtist,
    album
  };
}

export async function resolveGenresFromVideo({ keywords }: {
  keywords: string[];
}) {
  const genreSet = await fetchYouTubeMusicGenres();
  return extractGenresFromKeywords({
    keywords,
    genreSet
  });
}

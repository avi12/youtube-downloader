export { extractGenresFromKeywords, fetchYouTubeMusicGenres } from "./youtube-music-genres";

const VIDEO_TITLE_SUFFIX_PATTERN = /\s*[[(](?:official\s+(?:music\s+)?video|(?:official\s+)?lyrics?\s*(?:video)?|(?:official\s+)?audio|4k\s*remaster(?:ed)?|remaster(?:ed)?|hd|hq|visualizer|clip\s+officiel|video\s*oficial)[)\]]\s*/gi;
const FEATURING_PATTERN = /\s+(?:ft\.?|feat\.?|featuring)\s+(.+)$/i;

export function parseMusicTitle(title: string) {
  const cleaned = title.replaceAll(VIDEO_TITLE_SUFFIX_PATTERN, "").trim();

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

  const [, featuring] = afterSeparator.match(FEATURING_PATTERN) ?? [];
  const songTitle = afterSeparator.replace(FEATURING_PATTERN, "").trim();
  const fullArtist = featuring ? `${mainArtist} feat. ${featuring.trim()}` : mainArtist;

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
  const [rawTitle, ...artists] = titleArtistLine.split(" · ");
  const songTitle = rawTitle?.trim() || undefined;
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

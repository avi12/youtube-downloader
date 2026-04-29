import { parseDescriptionMetadata, parseMusicTitle, resolveGenresFromVideo } from "./music-metadata";
import { videoDataCache } from "./video-data";

export async function buildVideoMetadata(videoId: string) {
  const cached = videoDataCache.get(videoId);
  if (!cached) {
    return null;
  }

  const { playerResponse } = cached;
  const { videoDetails, microformat } = playerResponse;
  const thumbnails = videoDetails?.thumbnail?.thumbnails ?? [];
  const thumbnailUrl = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : undefined;
  const renderer = microformat?.playerMicroformatRenderer;
  const description = videoDetails?.shortDescription ?? "";
  const titleMeta = parseMusicTitle(cached.title);
  const descriptionMeta = parseDescriptionMetadata(description);
  const keywords = videoDetails?.keywords ?? [];
  const genres = await resolveGenresFromVideo({ keywords });
  const artist = descriptionMeta.artist || titleMeta.fullArtist || videoDetails?.author || "";
  const albumArtist = descriptionMeta.mainArtist || titleMeta.mainArtist || undefined;

  return {
    title: descriptionMeta.songTitle || titleMeta.songTitle,
    artist,
    albumArtist: albumArtist !== artist ? albumArtist : undefined,
    album: descriptionMeta.album,
    genres: genres.length > 0 ? genres : undefined,
    date: renderer?.publishDate,
    thumbnailUrl,
    isMusic: cached.isMusic
  };
}

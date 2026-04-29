import type { CaptionTrack, SubtitleStream } from "@/types";

async function fetchSubtitleSrt(track: CaptionTrack): Promise<string> {
  try {
    const baseUrl = track.baseUrl.startsWith("//") ? `https:${track.baseUrl}` : track.baseUrl;
    const url = new URL(baseUrl);
    url.searchParams.set("fmt", "srt");
    const srtUrl = url.toString();
    const response = await fetch(srtUrl);
    if (!response.ok) {
      console.warn(`[ytdl:bg] subtitle fetch ${response.status} for lang=${track.languageCode} url=${srtUrl.slice(0, 80)}`);
      return "";
    }

    return response.text();
  } catch (err) {
    console.warn(`[ytdl:bg] subtitle fetch threw for lang=${track.languageCode}:`, err);
    return "";
  }
}

export async function fetchSubtitleStreams(captionTracks: CaptionTrack[]): Promise<SubtitleStream[]> {
  const results = await Promise.all(
    captionTracks.map(async track => ({
      srtContent: await fetchSubtitleSrt(track),
      languageCode: track.languageCode,
      label: track.name.simpleText
    }))
  );
  return results.filter(stream => stream.srtContent);
}

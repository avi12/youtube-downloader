import type { AdaptiveFormatItem, CaptionTrack } from "@/types";

const FETCH_TIMEOUT_MS = 30_000;

interface ExtraAudioTrack {
  data: Uint8Array;
  mimeType: string;
  label: string;
}

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
}

async function fetchUrlBytes(url: string) {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      return null;
    }

    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

async function fetchSubtitleSrt(track: CaptionTrack) {
  try {
    const baseUrl = track.baseUrl.startsWith("//") ? `https:${track.baseUrl}` : track.baseUrl;
    const url = new URL(baseUrl);
    url.searchParams.set("fmt", "srt");
    const srtUrl = url.toString();
    const response = await fetchWithTimeout(srtUrl);
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

async function fetchExtraAudioTrack({ url, format, fallbackIndex }: {
  url: string | null | undefined;
  format: AdaptiveFormatItem;
  fallbackIndex: number;
}): Promise<ExtraAudioTrack | null> {
  if (!url) {
    return null;
  }

  const data = await fetchUrlBytes(url);
  if (!data) {
    return null;
  }

  return {
    data,
    mimeType: format.mimeType.split(";")[0] ?? "audio/mp4",
    label: format.audioTrack?.displayName ?? `Track ${fallbackIndex + 2}`
  };
}

export async function fetchExtraAudioTracksAndCaptions({
  additionalAudioFormats,
  resolvedExtraAudioUrls,
  captionTracks
}: {
  additionalAudioFormats: AdaptiveFormatItem[];
  resolvedExtraAudioUrls: (string | null)[];
  captionTracks: CaptionTrack[];
}) {
  const extraAudioPromises = additionalAudioFormats.map(
    (format, fallbackIndex) => fetchExtraAudioTrack({
      url: resolvedExtraAudioUrls[fallbackIndex],
      format,
      fallbackIndex
    })
  );
  const subtitlePromises = captionTracks.map(async track => ({
    srtContent: await fetchSubtitleSrt(track),
    languageCode: track.languageCode,
    label: track.name.simpleText
  }));

  const [extraAudio, subtitles] = await Promise.all([
    Promise.all(extraAudioPromises),
    Promise.all(subtitlePromises)
  ]);

  return {
    extraAudioTracks: extraAudio.filter(
      (track): track is ExtraAudioTrack => track !== null
    ),
    subtitleStreams: subtitles.filter(stream => stream.srtContent)
  };
}

import type { DownloadResult } from "./background-downloader";
import { createProgressFetch } from "./progress-fetch";
import { fetchAudioViaSabrStream } from "@/lib/youtube/sabr-download";
import type { AdaptiveFormatItem, SabrConfig } from "@/types";

export async function downloadExtraAudioTracksViaSabr({ config, formats, poToken, signal, onProgress }: {
  config: SabrConfig;
  formats: AdaptiveFormatItem[];
  poToken: string;
  signal: AbortSignal;
  onProgress?: () => void;
}) {
  const tracks: DownloadResult["additionalAudioTracks"] = [];

  for (const format of formats) {
    try {
      const sabrFetch = createProgressFetch({
        signal,
        onBytesReceived() {
          onProgress?.();
        }
      });
      const data = await fetchAudioViaSabrStream({
        sabrConfig: config,
        audioFormat: format,
        fetchFn: sabrFetch,
        poToken
      });
      tracks.push({
        data,
        mimeType: format.mimeType.split(";")[0] ?? "audio/mp4",
        label: format.audioTrack?.displayName ?? ""
      });
    } catch (trackError) {
      console.warn("[ytdl:bg] Extra audio track failed:", format.audioTrack?.displayName, trackError);
    }
  }

  return tracks;
}

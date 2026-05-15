import { createProgressFetch } from "./progress-fetch";
import { stripMimeParams } from "@/lib/utils/containers";
import { fetchAudioViaSabrStream, fetchVideoViaSabrStream } from "@/lib/youtube/sabr/download";
import type { AdaptiveFormatItem, SabrConfig } from "@/types";

function noop() {}

function makeFetch({ signal, onBytesReceived }: {
  signal: AbortSignal;
  onBytesReceived?: (bytes: number) => void;
}) {
  return createProgressFetch({
    signal,
    onBytesReceived: onBytesReceived ?? noop
  });
}

export async function downloadAudioOnlyViaSabr({ config, audioFormat, poToken, signal, onBytesReceived }: {
  config: SabrConfig;
  audioFormat: AdaptiveFormatItem;
  poToken: string;
  signal: AbortSignal;
  onBytesReceived?: (bytes: number) => void;
}) {
  return fetchAudioViaSabrStream({
    sabrConfig: config,
    audioFormat,
    fetchFunction: makeFetch({
      signal,
      onBytesReceived
    }),
    poToken,
    signal
  });
}

export async function downloadVideoAudioViaSabr({
  config, videoFormat, audioFormat, poToken, signal, onVideoBytesReceived, onAudioBytesReceived
}: {
  config: SabrConfig;
  videoFormat: AdaptiveFormatItem;
  audioFormat: AdaptiveFormatItem;
  poToken: string;
  signal: AbortSignal;
  onVideoBytesReceived?: (bytes: number) => void;
  onAudioBytesReceived?: (bytes: number) => void;
}) {
  return Promise.all([
    fetchVideoViaSabrStream({
      sabrConfig: config,
      videoFormat,
      fetchFunction: makeFetch({
        signal,
        onBytesReceived: onVideoBytesReceived
      }),
      poToken,
      signal
    }),
    fetchAudioViaSabrStream({
      sabrConfig: config,
      audioFormat,
      fetchFunction: makeFetch({
        signal,
        onBytesReceived: onAudioBytesReceived
      }),
      poToken,
      signal
    })
  ]);
}

export async function downloadExtraAudioTracksViaSabr({ config, formats, poToken, signal, onTrackBytesReceived }: {
  config: SabrConfig;
  formats: AdaptiveFormatItem[];
  poToken: string;
  signal: AbortSignal;
  onTrackBytesReceived?: (trackIndex: number, bytes: number) => void;
}) {
  const results = [];

  for (const [i, format] of formats.entries()) {
    try {
      const { data } = await fetchAudioViaSabrStream({
        sabrConfig: config,
        audioFormat: format,
        fetchFunction: makeFetch({
          signal,
          onBytesReceived: bytes => onTrackBytesReceived?.(i, bytes)
        }),
        poToken,
        signal
      });
      results.push({
        data,
        mimeType: stripMimeParams(format.mimeType),
        label: format.audioTrack?.displayName ?? "",
        languageCode: format.audioTrack?.id?.split(".")[0] ?? "",
        isDefault: format.audioTrack?.audioIsDefault ?? false
      });
    } catch (trackError) {
      console.warn("[ytdl:bg] Extra audio track failed:", format.audioTrack?.displayName, trackError);
    }
  }

  return results;
}

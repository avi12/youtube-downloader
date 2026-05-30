import { createProgressFetch } from "./progress-fetch";
import { stripMimeParams } from "@/lib/utils/containers";
import { fetchAudioViaSabrStream, fetchVideoViaSabrStream } from "@/lib/youtube/sabr/download";
import type { AdaptiveFormatItem, SabrConfig } from "@/types";

function noop() {}

type MakeFetchParams = {
  signal: AbortSignal;
  onBytesReceived?: (bytes: number) => void;
};
function makeFetch({ signal, onBytesReceived }: MakeFetchParams) {
  return createProgressFetch({
    signal,
    onBytesReceived: onBytesReceived ?? noop
  });
}

type DownloadAudioOnlyViaSabrParams = {
  config: SabrConfig;
  audioFormat: AdaptiveFormatItem;
  poToken: string;
  signal: AbortSignal;
  onBytesReceived?: (bytes: number) => void;
  onChunk?: (chunk: Uint8Array) => void;
};
export async function downloadAudioOnlyViaSabr(
  { config, audioFormat, poToken, signal, onBytesReceived, onChunk }: DownloadAudioOnlyViaSabrParams
) {
  return fetchAudioViaSabrStream({
    sabrConfig: config,
    audioFormat,
    fetchFunction: makeFetch({
      signal,
      onBytesReceived
    }),
    poToken,
    signal,
    onChunk
  });
}

type DownloadVideoAudioViaSabrParams = {
  config: SabrConfig;
  videoFormat: AdaptiveFormatItem;
  audioFormat: AdaptiveFormatItem;
  poToken: string;
  signal: AbortSignal;
  onVideoBytesReceived?: (bytes: number) => void;
  onAudioBytesReceived?: (bytes: number) => void;
  onVideoChunk?: (chunk: Uint8Array) => void;
  onAudioChunk?: (chunk: Uint8Array) => void;
};
export async function downloadVideoAudioViaSabr({
  config, videoFormat, audioFormat, poToken, signal,
  onVideoBytesReceived, onAudioBytesReceived, onVideoChunk, onAudioChunk
}: DownloadVideoAudioViaSabrParams) {
  return Promise.all([
    fetchVideoViaSabrStream({
      sabrConfig: config,
      videoFormat,
      fetchFunction: makeFetch({
        signal,
        onBytesReceived: onVideoBytesReceived
      }),
      poToken,
      signal,
      onChunk: onVideoChunk
    }),
    fetchAudioViaSabrStream({
      sabrConfig: config,
      audioFormat,
      fetchFunction: makeFetch({
        signal,
        onBytesReceived: onAudioBytesReceived
      }),
      poToken,
      signal,
      onChunk: onAudioChunk
    })
  ]);
}

type DownloadExtraAudioTracksViaSabrParams = {
  config: SabrConfig;
  formats: AdaptiveFormatItem[];
  poToken: string;
  signal: AbortSignal;
  onTrackBytesReceived?: (params: {
    trackIndex: number;
    bytes: number;
  }) => void;
};
export async function downloadExtraAudioTracksViaSabr(
  { config, formats, poToken, signal, onTrackBytesReceived }: DownloadExtraAudioTracksViaSabrParams
) {
  const results = [];

  for (const [i, format] of formats.entries()) {
    try {
      const { data } = await fetchAudioViaSabrStream({
        sabrConfig: config,
        audioFormat: format,
        fetchFunction: makeFetch({
          signal,
          onBytesReceived: bytes => onTrackBytesReceived?.({
            trackIndex: i,
            bytes
          })
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

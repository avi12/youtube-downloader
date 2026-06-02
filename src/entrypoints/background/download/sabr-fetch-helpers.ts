import { stripMimeParams } from "@/lib/utils/containers";
import { fetchAudioViaSabrStream, fetchVideoViaSabrStream } from "@/lib/youtube/sabr/download";
import type { AdaptiveFormatItem, SabrConfig } from "@/types";

type MakeFetchParams = {
  signal: AbortSignal;
};
function makeFetch({ signal }: MakeFetchParams) {
  return (input: RequestInfo | URL, init?: RequestInit) => fetch(input, {
    ...init,
    signal,
    credentials: "include"
  });
}

type DownloadAudioOnlyViaSabrParams = {
  config: SabrConfig;
  audioFormat: AdaptiveFormatItem;
  poToken: string;
  signal: AbortSignal;
  onChunk?: (chunk: Uint8Array) => void;
};
export async function downloadAudioOnlyViaSabr(
  { config, audioFormat, poToken, signal, onChunk }: DownloadAudioOnlyViaSabrParams
) {
  return fetchAudioViaSabrStream({
    sabrConfig: config,
    audioFormat,
    fetchFunction: makeFetch({ signal }),
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
  onVideoChunk?: (chunk: Uint8Array) => void;
  onAudioChunk?: (chunk: Uint8Array) => void;
};
export async function downloadVideoAudioViaSabr({
  config, videoFormat, audioFormat, poToken, signal, onVideoChunk, onAudioChunk
}: DownloadVideoAudioViaSabrParams) {
  return Promise.all([
    fetchVideoViaSabrStream({
      sabrConfig: config,
      videoFormat,
      fetchFunction: makeFetch({ signal }),
      poToken,
      signal,
      onChunk: onVideoChunk
    }),
    fetchAudioViaSabrStream({
      sabrConfig: config,
      audioFormat,
      fetchFunction: makeFetch({ signal }),
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
  onTrackChunk?: (params: {
    trackIndex: number;
    chunk: Uint8Array;
  }) => void;
};
export async function downloadExtraAudioTracksViaSabr(
  { config, formats, poToken, signal, onTrackChunk }: DownloadExtraAudioTracksViaSabrParams
) {
  const results = [];

  for (const [i, format] of formats.entries()) {
    try {
      const { data } = await fetchAudioViaSabrStream({
        sabrConfig: config,
        audioFormat: format,
        fetchFunction: makeFetch({ signal }),
        poToken,
        signal,
        onChunk: chunk => onTrackChunk?.({
          trackIndex: i,
          chunk
        })
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

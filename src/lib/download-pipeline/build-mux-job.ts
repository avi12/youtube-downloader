import {
  toUint8Array,
  toOwnedArrayBuffer,
  triggerDownload,
  reportProgress,
  buildRecentContext
} from ".";
import type { MuxVideoAudioJob } from "./mux-worker-types";
import { ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

type ExtraAudioTrack = MuxVideoAudioJob["extraAudioTracks"][number];
type SubtitleFile = MuxVideoAudioJob["subtitleTracks"][number];

export function buildExtraAudioTracks(additionalAudioStreams: ProcessStreamData["additionalAudioStreams"]): ExtraAudioTrack[] {
  return additionalAudioStreams
    .map(stream => {
      const data = toUint8Array(stream.data);
      if (!data) {
        return null;
      }

      return {
        data: toOwnedArrayBuffer(data),
        label: stream.label,
        languageCode: stream.languageCode ?? ""
      };
    })
    .filter((track): track is ExtraAudioTrack => track !== null);
}

export function buildSubtitleFiles(subtitleTracks: ProcessStreamData["subtitleTracks"]): SubtitleFile[] {
  return subtitleTracks
    .filter(track => track.data !== null)
    .map(track => ({
      data: track.data!,
      label: track.label,
      languageCode: track.languageCode
    }));
}

export function resolveDownloadFilename(filenameOutput: string, hasExtraTracks: boolean) {
  const targetExtension = hasExtraTracks ? "mkv" : (filenameOutput.split(".").pop() ?? "mkv");
  return `${filenameOutput.replace(/\.[^.]+$/, "")}.${targetExtension}`;
}

export async function handleSingleStream(
  item: ProcessStreamData,
  videoData: Uint8Array | null,
  audioData: Uint8Array | null
) {
  if (!videoData && !audioData) {
    throw new Error("No stream data accumulated");
  }

  const recentContext = buildRecentContext(item);
  const data = (videoData ?? audioData)!;
  await triggerDownload({
    data,
    filenameOutput: item.filenameOutput,
    recentContext
  });
  await reportProgress({
    videoId: item.videoId,
    progress: 1,
    progressType: ProgressType.FFmpeg,
    tabId: item.tabId
  });
}

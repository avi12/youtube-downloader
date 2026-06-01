import {
  toUint8Array,
  toOwnedArrayBuffer,
  triggerDownload,
  reportProgress,
  buildRecentContext
} from ".";
import type { AudioTrack } from "./mux-worker-types";
import { resolveMultiTrackExtension } from "@/lib/utils/containers";
import { ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

const MKV_EXTENSION = "mkv";
const NO_STREAM_DATA_ERROR = "No stream data accumulated";

export function buildAdditionalAudioTracks(additionalAudioStreams: ProcessStreamData["additionalAudioStreams"]) {
  return additionalAudioStreams
    .map(stream => {
      const data = toUint8Array(stream.data);
      const isDataMissing = !data;
      if (isDataMissing) {
        return null;
      }

      return {
        data: toOwnedArrayBuffer(data),
        label: stream.label,
        languageCode: stream.languageCode ?? ""
      };
    })
    .filter((track): track is AudioTrack => track !== null);
}

export function buildSubtitleFiles(subtitleTracks: ProcessStreamData["subtitleTracks"]) {
  return subtitleTracks
    .filter(track => track.data !== null)
    .map(track => ({
      data: track.data!,
      label: track.label,
      languageCode: track.languageCode
    }));
}

type ResolveDownloadFilenameParams = {
  filenameOutput: string;
  hasExtraTracks: boolean;
};
export function resolveDownloadFilename({ filenameOutput, hasExtraTracks }: ResolveDownloadFilenameParams) {
  const existingExtension = filenameOutput.split(".").pop() ?? MKV_EXTENSION;
  const targetExtension = hasExtraTracks ? resolveMultiTrackExtension(existingExtension) : existingExtension;
  return `${filenameOutput.replace(/\.[^.]+$/, "")}.${targetExtension}`;
}

type HandleSingleStreamParams = {
  item: ProcessStreamData;
  videoData: Uint8Array | null;
  audioData: Uint8Array | null;
};
export async function handleSingleStream({ item, videoData, audioData }: HandleSingleStreamParams) {
  const hasNoData = !videoData && !audioData;
  if (hasNoData) {
    throw new Error(NO_STREAM_DATA_ERROR);
  }

  const { videoId, tabId, filenameOutput } = item;
  const recentContext = buildRecentContext({ item });
  const data = (videoData ?? audioData)!;
  await triggerDownload({
    data,
    filenameOutput,
    recentContext
  });
  await reportProgress({
    videoId,
    progress: 1,
    progressType: ProgressType.FFmpeg,
    tabId
  });
}

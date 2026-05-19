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

const MKV_EXTENSION = "mkv";
const NO_STREAM_DATA_ERROR = "No stream data accumulated";

type ExtraAudioTrack = MuxVideoAudioJob["extraAudioTracks"][number];

export function buildExtraAudioTracks(additionalAudioStreams: ProcessStreamData["additionalAudioStreams"]) {
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
  const targetExtension = hasExtraTracks ? MKV_EXTENSION : (filenameOutput.split(".").pop() ?? MKV_EXTENSION);
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

  const recentContext = buildRecentContext({ item });
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

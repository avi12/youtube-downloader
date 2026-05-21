import { handleProcessStreamChunk } from "./stream/accumulator";
import { handleProcessStreamEnd } from "./stream/end-handler";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import type { OffscreenProtocolMap } from "@/lib/messaging/offscreen-messaging";
import { OffscreenMessageType } from "@/lib/messaging/offscreen-messaging";
import { uint8ToBase64 } from "@/lib/utils/binary";
import { fetchAudioViaSabrStream } from "@/lib/youtube/sabr/download";
import { DownloadType, StreamType } from "@/types";

const DEFAULT_VIDEO_MIME_TYPE = "video/mp4";

type AudioSabrData = OffscreenProtocolMap[typeof OffscreenMessageType.DownloadAudioViaSabr];

function makeFetch() {
  return async (input: RequestInfo | URL, init?: RequestInit) => fetch(input, {
    ...init,
    credentials: "include"
  });
}

export async function handleOffscreenAudioDownload(data: AudioSabrData) {
  const {
    videoId, tabId, sabrConfig, audioFormat, poToken,
    type, filenameOutput, audioMimeType, audioTrackLabels, audioTrackLanguages,
    subtitleTracks, playlistId, playlistTitle, playlistTotalCount, enrichedMetadata
  } = data;

  try {
    let iChunk = 0;
    await fetchAudioViaSabrStream({
      sabrConfig,
      audioFormat,
      fetchFunction: makeFetch(),
      poToken,
      onChunk(chunk) {
        handleProcessStreamChunk({
          videoId,
          streamType: StreamType.Audio,
          iChunk: iChunk++,
          totalChunks: 0,
          chunkBase64: uint8ToBase64(chunk),
          tabId
        });
      }
    });

    handleProcessStreamChunk({
      videoId,
      streamType: StreamType.Audio,
      iChunk: -1,
      totalChunks: iChunk,
      chunkBase64: "",
      tabId
    });

    void handleProcessStreamEnd({
      type,
      videoId,
      filenameOutput,
      videoMimeType: DEFAULT_VIDEO_MIME_TYPE,
      audioMimeType,
      audioTrackLabels,
      audioTrackLanguages,
      defaultAudioTrackIndex: 0,
      subtitleTracks,
      tabId,
      playlistId,
      playlistTitle,
      playlistTotalCount,
      metadata: enrichedMetadata
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await sendMessage(MessageType.ProcessStreamError, {
      videoId,
      error: errorMessage
    });
    await sendMessage(MessageType.PipelineQueueRemove, {
      videoId,
      type: DownloadType.Audio
    });
  }
}

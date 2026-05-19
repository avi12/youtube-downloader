import { handleProcessStreamChunk } from "./stream/accumulator";
import { handleProcessStreamEnd } from "./stream/end-handler";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import type { OffscreenProtocolMap } from "@/lib/messaging/offscreen-messaging";
import { OffscreenMessageType } from "@/lib/messaging/offscreen-messaging";
import { uint8ToBase64 } from "@/lib/utils/binary";
import { fetchAudioViaSabrStream } from "@/lib/youtube/sabr/download";
import { DownloadType, StreamType } from "@/types";

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

  console.log("[ytdl:offscreen] Starting audio SABR download for", videoId);

  try {
    let iChunk = 0;
    const audioResult = await fetchAudioViaSabrStream({
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

    if (!audioResult.isComplete) {
      console.warn("[ytdl:offscreen] Audio SABR download incomplete for", videoId);
    }

    void handleProcessStreamEnd({
      type,
      videoId,
      filenameOutput,
      videoMimeType: "video/mp4",
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
    console.error("[ytdl:offscreen] Audio SABR download failed:", errorMessage);
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

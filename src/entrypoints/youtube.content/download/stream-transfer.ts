import { popPlaylistContext, sendStreamChunks } from "./stream-chunks";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { AUDIO_EXTRA_STREAM_PREFIX, StreamType } from "@/types";
import type { Prettify, StreamDataPayload } from "@/types";

export { setPlaylistContext } from "./stream-chunks";

const cancelledVideoIds = new Set<string>();

export function cancelStreamTransfer(videoId: string) {
  cancelledVideoIds.add(videoId);
}

export function uncancelStreamTransfer(videoId: string) {
  cancelledVideoIds.delete(videoId);
}

export async function handleStreamData(payload: StreamDataPayload) {
  const {
    downloadType, videoId, filenameOutput,
    videoData, audioData, videoMimeType, audioMimeType,
    audioLabel, additionalAudioData
  } = payload;
  if (cancelledVideoIds.has(videoId)) {
    return;
  }

  const streamTasks: Promise<void>[] = [];
  if (videoData) {
    streamTasks.push(
      sendStreamChunks({
        videoId,
        streamType: StreamType.Video,
        data: videoData
      })
    );
  }

  if (audioData) {
    streamTasks.push(
      sendStreamChunks({
        videoId,
        streamType: StreamType.Audio,
        data: audioData
      })
    );
  }

  for (const [i, track] of additionalAudioData.entries()) {
    if (track.data) {
      streamTasks.push(
        sendStreamChunks({
          videoId,
          streamType: `${AUDIO_EXTRA_STREAM_PREFIX}-${i}`,
          data: track.data
        })
      );
    }
  }

  await Promise.all(streamTasks);

  const audioTrackLabels = [
    audioLabel ?? "",
    ...additionalAudioData.map(track => track.label)
  ];

  const playlistContext = popPlaylistContext(videoId);

  await sendMessage(MessageType.StreamEnd, {
    type: downloadType,
    videoId,
    filenameOutput,
    videoMimeType,
    audioMimeType,
    audioTrackLabels,
    metadata: payload.metadata,
    ...playlistContext
  });
}

type HandleStreamErrorParams = Prettify<{
  videoId: string;
  error: string;
}>;
export function handleStreamError({ videoId, error }: HandleStreamErrorParams) {
  console.error("[ytdl] Stream error for", videoId, error);

  sendMessage(MessageType.ProcessStreamError, {
    videoId,
    error
  }).catch(() => {});
}

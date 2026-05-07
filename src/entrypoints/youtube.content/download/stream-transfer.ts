import { buildStreamTasks } from "./stream-chunks";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { downloadProgressStore } from "@/lib/ui/synced-stores.svelte";
import type { StreamDataPayload } from "@/types";

const cancelledVideoIds = new Set<string>();

export function cancelStreamTransfer(videoId: string) {
  cancelledVideoIds.add(videoId);
}

export function uncancelStreamTransfer(videoId: string) {
  cancelledVideoIds.delete(videoId);
}

const playlistContextByVideoId = new Map<string, {
  playlistId: string;
  playlistTitle: string;
  playlistTotalCount: number;
}>();

export function setPlaylistContext({ videoId, context }: {
  videoId: string;
  context: Parameters<typeof playlistContextByVideoId.set>[1];
}) {
  playlistContextByVideoId.set(videoId, context);
}

export async function handleStreamData(payload: StreamDataPayload) {
  const {
    downloadType, videoId, filenameOutput, videoData, audioData,
    videoMimeType, audioMimeType, audioLabel, additionalAudioData, segments
  } = payload;
  if (cancelledVideoIds.has(videoId)) {
    return;
  }

  const streamTasks = buildStreamTasks({
    videoId,
    videoData,
    audioData,
    additionalAudioData,
    segments
  });
  await Promise.all(streamTasks);

  const audioTrackLabels = [audioLabel ?? "", ...additionalAudioData.map(track => track.label)];
  const playlistContext = playlistContextByVideoId.get(videoId);
  playlistContextByVideoId.delete(videoId);

  void sendMessage(MessageType.StreamEnd, {
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

export function handleStreamError({ videoId, error }: {
  videoId: string;
  error: string;
}) {
  console.error("[ytdl] Stream error for", videoId, error);
  downloadProgressStore.delete(videoId);
  void sendMessage(MessageType.ProcessStreamError, {
    videoId,
    error
  });
}

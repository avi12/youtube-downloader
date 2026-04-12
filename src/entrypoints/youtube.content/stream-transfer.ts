/**
 * Transfers large binary streams from the MAIN world to the background
 * by splitting them into base64-encoded 1MB chunks that stay under
 * Chrome's runtime.sendMessage size limit.
 */

import { uint8ToBase64 } from "@/lib/binary";
import { MessageType, sendMessage } from "@/lib/messaging";
import { downloadProgressStore } from "@/lib/synced-stores.svelte";
import { StreamType } from "@/types";
import type { StreamDataPayload } from "@/types";

const TRANSFER_CHUNK_SIZE = 1024 * 1024;
const cancelledVideoIds = new Set<string>();

export function cancelStreamTransfer(videoId: string) {
  cancelledVideoIds.add(videoId);
}

export function uncancelStreamTransfer(videoId: string) {
  cancelledVideoIds.delete(videoId);
}

async function sendStreamChunks({ videoId, streamType, data }: {
  videoId: string;
  streamType: string;
  data: Uint8Array;
}) {
  if (cancelledVideoIds.has(videoId)) {
    return;
  }

  const totalChunks = Math.ceil(data.byteLength / TRANSFER_CHUNK_SIZE);

  await Promise.all(
    Array.from({ length: totalChunks }, (_, iChunk) => {
      const start = iChunk * TRANSFER_CHUNK_SIZE;
      const chunk = data.subarray(start, start + TRANSFER_CHUNK_SIZE);
      return sendMessage(MessageType.StreamChunk, {
        videoId,
        streamType,
        iChunk,
        totalChunks,
        chunkBase64: uint8ToBase64(chunk)
      });
    })
  );
}

interface PlaylistContext {
  playlistId: string;
  playlistTitle: string;
  playlistTotalCount: number;
}

const playlistContextByVideoId = new Map<string, PlaylistContext>();

export function setPlaylistContext(videoId: string, context: PlaylistContext) {
  playlistContextByVideoId.set(videoId, context);
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
    streamTasks.push(sendStreamChunks({ videoId, streamType: StreamType.Video, data: videoData }));
  }

  if (audioData) {
    streamTasks.push(sendStreamChunks({ videoId, streamType: StreamType.Audio, data: audioData }));
  }

  for (const [i, track] of additionalAudioData.entries()) {
    if (track.data) {
      streamTasks.push(sendStreamChunks({ videoId, streamType: `audio-extra-${i}`, data: track.data }));
    }
  }

  await Promise.all(streamTasks);

  const audioTrackLabels = [
    audioLabel ?? "",
    ...additionalAudioData.map(track => track.label)
  ];

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

  // Reset download state so the button isn't stuck at "downloading"
  downloadProgressStore.delete(videoId);

  void sendMessage(MessageType.ProcessStreamError, {
    videoId,
    error
  });
}

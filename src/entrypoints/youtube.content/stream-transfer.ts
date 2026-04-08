/**
 * Transfers large binary streams from the MAIN world to the background
 * by splitting them into base64-encoded 1MB chunks that stay under
 * Chrome's runtime.sendMessage size limit.
 */

import { MessageType, sendMessage } from "@/lib/messaging";
import { downloadProgressStore } from "@/lib/synced-stores.svelte";
import type { StreamDataPayload } from "@/types";

const TRANSFER_CHUNK_SIZE = 1024 * 1024;
const cancelledVideoIds = new Set<string>();

export function cancelStreamTransfer(videoId: string) {
  cancelledVideoIds.add(videoId);
}

export function uncancelStreamTransfer(videoId: string) {
  cancelledVideoIds.delete(videoId);
}

function uint8ToBase64(bytes: Uint8Array) {
  let binary = "";
  const batchSize = 8192;

  for (let offset = 0; offset < bytes.byteLength; offset += batchSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + batchSize, bytes.byteLength))
    );
  }

  return btoa(binary);
}

async function sendStreamChunks({ videoId, streamType, data }: {
  videoId: string;
  streamType: string;
  data: Uint8Array;
}) {
  const totalChunks = Math.ceil(data.byteLength / TRANSFER_CHUNK_SIZE);

  for (let iChunk = 0; iChunk < totalChunks; iChunk++) {
    // Yield to the event loop so cancel signals can be processed
    // and the UI stays responsive during large transfers
    await new Promise(resolve => setTimeout(resolve, 0));

    if (cancelledVideoIds.has(videoId)) {
      return;
    }

    const start = iChunk * TRANSFER_CHUNK_SIZE;
    const chunk = data.subarray(start, start + TRANSFER_CHUNK_SIZE);

    await sendMessage(MessageType.StreamChunk, {
      videoId,
      streamType,
      iChunk,
      totalChunks,
      chunkBase64: uint8ToBase64(chunk)
    });
  }
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

  if (videoData) {
    await sendStreamChunks({
      videoId,
      streamType: "video",
      data: videoData
    });
  }

  if (audioData) {
    await sendStreamChunks({
      videoId,
      streamType: "audio",
      data: audioData
    });
  }

  const extraAudioStreams = additionalAudioData ?? [];

  for (let iTrack = 0; iTrack < extraAudioStreams.length; iTrack++) {
    const track = extraAudioStreams[iTrack];
    if (track.data) {
      await sendStreamChunks({
        videoId,
        streamType: `audio-extra-${iTrack}`,
        data: track.data
      });
    }
  }

  const audioTrackLabels = [
    audioLabel ?? "",
    ...extraAudioStreams.map(track => track.label)
  ];

  const playlistContext = playlistContextByVideoId.get(videoId);
  playlistContextByVideoId.delete(videoId);

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

export async function handleStreamError({ videoId, error }: { videoId: string;
  error: string; }) {
  console.error("[ytdl] Stream error for", videoId, error);

  // Reset download state so the button isn't stuck at "downloading"
  downloadProgressStore.delete(videoId);

  await sendMessage(MessageType.ProcessStreamError, {
    videoId,
    error
  });
}

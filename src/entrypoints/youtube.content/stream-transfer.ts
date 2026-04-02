/**
 * Transfers large binary streams from the MAIN world to the background
 * by splitting them into base64-encoded 1MB chunks that stay under
 * Chrome's runtime.sendMessage size limit.
 */

import { MessageType, sendMessage } from "@/lib/messaging";

const TRANSFER_CHUNK_SIZE = 1024 * 1024;

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

async function sendStreamChunks(
  videoId: string,
  streamType: string,
  data: Uint8Array
) {
  const totalChunks = Math.ceil(data.byteLength / TRANSFER_CHUNK_SIZE);

  for (let iChunk = 0; iChunk < totalChunks; iChunk++) {
    const start = iChunk * TRANSFER_CHUNK_SIZE;
    const chunk = data.slice(start, start + TRANSFER_CHUNK_SIZE);

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

export async function handleStreamData(e: Event) {
  if (!(e instanceof CustomEvent)) {
    return;
  }

  const {
    downloadType, videoId, filenameOutput,
    videoData, audioData, videoMimeType, audioMimeType,
    audioLabel, additionalAudioData
  } = e.detail;
  if (videoData) {
    await sendStreamChunks(videoId, "video", videoData);
  }

  if (audioData) {
    await sendStreamChunks(videoId, "audio", audioData);
  }

  const extraAudioStreams: Array<{ data: Uint8Array; label: string }> = additionalAudioData ?? [];

  for (let iTrack = 0; iTrack < extraAudioStreams.length; iTrack++) {
    const track = extraAudioStreams[iTrack];
    if (track.data) {
      await sendStreamChunks(videoId, `audio-extra-${iTrack}`, track.data);
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
    ...playlistContext
  });
}

export async function handleStreamError(e: Event) {
  if (!(e instanceof CustomEvent)) {
    return;
  }

  const { videoId, error }: { videoId: string; error: string } = e.detail;
  await sendMessage(MessageType.ProcessStreamError, { videoId, error });
}

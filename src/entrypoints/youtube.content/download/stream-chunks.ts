import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { TRANSFER_CHUNK_SIZE, uint8ToBase64 } from "@/lib/utils/binary";
import { StreamType } from "@/types";

export async function sendStreamChunks({ videoId, streamType, data }: {
  videoId: string;
  streamType: string;
  data: Uint8Array;
}) {
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

export function buildStreamTasks({ videoId, videoData, audioData, additionalAudioData, segments }: {
  videoId: string;
  videoData: Uint8Array | null | undefined;
  audioData: Uint8Array | null | undefined;
  additionalAudioData: {
    data: Uint8Array | null;
    mimeType: string;
    label: string;
  }[];
  segments?: {
    video: Uint8Array;
    audio: Uint8Array;
  }[];
}): Promise<void>[] {
  const tasks: Promise<void>[] = [];
  if (segments && segments.length > 0) {
    for (const [i, segment] of segments.entries()) {
      tasks.push(
        sendStreamChunks({
          videoId,
          streamType: `video-seg-${i}`,
          data: segment.video
        }),
        sendStreamChunks({
          videoId,
          streamType: `audio-seg-${i}`,
          data: segment.audio
        })
      );
    }

    return tasks;
  }

  if (videoData) {
    tasks.push(
      sendStreamChunks({
        videoId,
        streamType: StreamType.Video,
        data: videoData
      })
    );
  }

  if (audioData) {
    tasks.push(
      sendStreamChunks({
        videoId,
        streamType: StreamType.Audio,
        data: audioData
      })
    );
  }

  for (const [i, track] of additionalAudioData.entries()) {
    if (track.data) {
      tasks.push(
        sendStreamChunks({
          videoId,
          streamType: `audio-extra-${i}`,
          data: track.data
        })
      );
    }
  }

  return tasks;
}

import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { TRANSFER_CHUNK_SIZE, uint8ToBase64 } from "@/lib/utils/binary";
import { AUDIO_EXTRA_STREAM_PREFIX, StreamType } from "@/types";
import type { CaptionTrack } from "@/types";

const YIELD_EVERY_N_CHUNKS = 32;

export async function sendStreamChunksToOffscreen({ videoId, streamType, data, tabId }: {
  videoId: string;
  streamType: string;
  data: Uint8Array;
  tabId: number;
}) {
  const totalChunks = Math.ceil(data.byteLength / TRANSFER_CHUNK_SIZE);

  for (let iChunk = 0; iChunk < totalChunks; iChunk++) {
    const start = iChunk * TRANSFER_CHUNK_SIZE;
    const chunk = data.subarray(start, start + TRANSFER_CHUNK_SIZE);
    sendToOffscreen({
      type: OffscreenMessageType.ProcessStreamChunk,
      data: {
        videoId,
        streamType,
        iChunk,
        totalChunks,
        chunkBase64: uint8ToBase64(chunk),
        tabId
      }
    });

    if ((iChunk + 1) % YIELD_EVERY_N_CHUNKS === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
}

export function buildTransferJobs({ videoData, audioData, additionalAudioTracks, videoId, tabId }: {
  videoData: Uint8Array | null;
  audioData: Uint8Array | null;
  additionalAudioTracks: { data: Uint8Array | null }[];
  videoId: string;
  tabId: number;
}) {
  const jobs: Promise<void>[] = [];
  if (videoData) {
    jobs.push(
      sendStreamChunksToOffscreen({
        videoId,
        streamType: StreamType.Video,
        data: videoData,
        tabId
      })
    );
  }

  if (audioData) {
    jobs.push(
      sendStreamChunksToOffscreen({
        videoId,
        streamType: StreamType.Audio,
        data: audioData,
        tabId
      })
    );
  }

  for (const [i, track] of additionalAudioTracks.entries()) {
    if (track.data) {
      jobs.push(
        sendStreamChunksToOffscreen({
          videoId,
          streamType: `${AUDIO_EXTRA_STREAM_PREFIX}-${i}`,
          data: track.data,
          tabId
        })
      );
    }
  }

  return jobs;
}

export function buildSubtitleTracks({ captionTracks, captionVttData }: {
  captionTracks: CaptionTrack[] | undefined;
  captionVttData: (string | null)[];
}) {
  const subtitleTracks: {
    dataBase64: string;
    label: string;
    languageCode: string;
  }[] = [];
  for (const [i, track] of (captionTracks ?? []).entries()) {
    const dataBase64 = captionVttData[i];
    if (dataBase64) {
      subtitleTracks.push({
        dataBase64,
        label: track.name.simpleText,
        languageCode: track.languageCode
      });
    }
  }

  return subtitleTracks;
}

import { ensureProcessor } from "../handlers/processor";
import type { DownloadResult } from "./download-result-types";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { TRANSFER_CHUNK_SIZE, uint8ToBase64 } from "@/lib/utils/binary";
import { stripMimeParams } from "@/lib/utils/containers";
import { AUDIO_EXTRA_STREAM_PREFIX, ProgressType, StreamType } from "@/types";
import type { DownloadRequest, VideoMetadata } from "@/types";

const YIELD_EVERY_N_CHUNKS = 32;

async function sendStreamChunksToOffscreen({ videoId, streamType, data, tabId }: {
  videoId: string;
  streamType: string;
  data: Uint8Array;
  tabId: number;
}) {
  const totalChunks = Math.ceil(data.byteLength / TRANSFER_CHUNK_SIZE);

  for (let iChunk = 0; iChunk < totalChunks; iChunk++) {
    const start = iChunk * TRANSFER_CHUNK_SIZE;
    const chunk = data.subarray(start, start + TRANSFER_CHUNK_SIZE);
    sendToOffscreen(OffscreenMessageType.ProcessStreamChunk, {
      videoId,
      streamType,
      iChunk,
      totalChunks,
      chunkBase64: uint8ToBase64(chunk),
      tabId
    });

    if ((iChunk + 1) % YIELD_EVERY_N_CHUNKS === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
}

export async function dispatchToOffscreen({ request, result, enrichedMetadata, tabId }: {
  request: DownloadRequest;
  result: DownloadResult;
  enrichedMetadata: VideoMetadata | null | undefined;
  tabId: number;
}) {
  void sendMessage(MessageType.UpdateDownloadProgress, {
    videoId: request.videoId,
    progress: 0,
    progressType: ProgressType.FFmpeg
  }, tabId);
  await ensureProcessor();

  const {
    videoId, type, filenameOutput, videoFormat, audioFormat,
    primaryAudioLabel, captionTracks, playlistId, playlistTitle, playlistTotalCount
  } = request;
  const { videoData, audioData, additionalAudioTracks } = result;

  const resolvedVideoMimeType = videoFormat ? stripMimeParams(videoFormat.mimeType) : "video/mp4";
  const resolvedAudioMimeType = audioFormat ? stripMimeParams(audioFormat.mimeType) : "audio/mp4";
  const transferJobs: Promise<void>[] = [];
  if (videoData) {
    transferJobs.push(
      sendStreamChunksToOffscreen({
        videoId,
        streamType: StreamType.Video,
        data: videoData,
        tabId
      })
    );
  }

  if (audioData) {
    transferJobs.push(
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
      transferJobs.push(
        sendStreamChunksToOffscreen({
          videoId,
          streamType: `${AUDIO_EXTRA_STREAM_PREFIX}-${i}`,
          data: track.data,
          tabId
        })
      );
    }
  }

  await Promise.all(transferJobs);

  const audioTrackLabels = [primaryAudioLabel ?? "", ...additionalAudioTracks.map(track => track.label)];
  const audioTrackLanguages = [
    request.primaryAudioLanguageCode ?? "",
    ...additionalAudioTracks.map(track => track.languageCode)
  ];

  const captionVttData = request.captionVttData ?? [];
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

  sendToOffscreen(OffscreenMessageType.ProcessStreamEnd, {
    type,
    videoId,
    filenameOutput,
    videoMimeType: resolvedVideoMimeType,
    audioMimeType: resolvedAudioMimeType,
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
}

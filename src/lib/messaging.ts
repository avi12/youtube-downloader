import type {
  DownloadRequest,
  DownloadType,
  InterruptedDownload,
  ProgressUpdate,
  StreamError
} from "../types";
import { defineExtensionMessaging } from "@webext-core/messaging";

// ─── Protocol definition ──────────────────────────────────────────────────────

interface ProtocolMap {
  // Content script → Background: stream chunk (1 MB base64-encoded segment)
  // streamType is "video", "audio", or "audio-extra-{index}" for additional language tracks
  // Binary data is base64-encoded because runtime.sendMessage uses JSON serialization
  streamChunk(data: {
    videoId: string;
    streamType: string;
    iChunk: number;
    totalChunks: number;
    chunkBase64: string;
  }): void;

  // Content script → Background: all chunks sent, trigger muxing/download
  // audioTrackLabels[0] = primary audio label, [1..] = additional track labels
  streamEnd(data: {
    type: DownloadType;
    videoId: string;
    filenameOutput: string;
    videoMimeType: string;
    audioMimeType: string;
    audioTrackLabels: string[];
  }): void;

  // Content script → Background: SABR stream fetch failed
  processStreamError(data: StreamError): void;

  // Content script → Background: get captured SABR request body for this tab
  getCapturedSabrBody(data: Record<string, never>): { body: string; url: string; poToken: string } | null;

  // Content script → Background: persist/clear interrupted download state
  persistInterruptedDownload(data: InterruptedDownload): void;
  clearInterruptedDownload(data: { videoId: string }): void;

  // Content script → Background: download all items in a playlist
  requestPlaylistDownload(data: { items: DownloadRequest[] }): void;

  // Content script → Background: cancel one or more downloads
  cancelDownload(data: { videoIds: string[] }): void;

  // Background → Content script (per tab): trigger a single download item
  executeDownloadItem(data: DownloadRequest): void;

  // Background → Content script (per tab): SABR body captured, download ready
  sabrBodyReady(data: Record<string, never>): void;

  // Background → Content script (per tab): progress update
  updateDownloadProgress(data: ProgressUpdate): void;

  // Background → Offscreen (Chrome only): forwarded stream chunk
  processStreamChunk(data: {
    videoId: string;
    streamType: string;
    iChunk: number;
    totalChunks: number;
    chunkBase64: string;
    tabId: number;
  }): void;

  // Background → Offscreen (Chrome only): all chunks forwarded, trigger processing
  processStreamEnd(data: {
    type: DownloadType;
    videoId: string;
    filenameOutput: string;
    videoMimeType: string;
    audioMimeType: string;
    audioTrackLabels: string[];
    tabId: number;
  }): void;

  // Background → Offscreen (Chrome only): cancel one or more downloads
  cancelProcessing(data: { videoIds: string[] }): void;

  // Offscreen → Background: storage operations (chrome.storage unavailable in offscreen)
  pipelineProgress(data: ProgressUpdate & { tabId: number }): void;
  pipelineRemoval(data: { videoId: string; tabId: number }): void;
  pipelineQueueRemove(data: { videoId: string; type: DownloadType }): void;
  pipelineFFmpegReady(data: Record<string, never>): void;
  pipelineDownload(data: { blobUrl: string; mimeType: string; filename: string }): void;
}

export const { sendMessage, onMessage } =
  defineExtensionMessaging<ProtocolMap>({
    // Allow raw runtime.sendMessage calls (e.g. for binary data transfer
    // with __ytdl_stream) to pass through without throwing errors
    breakError: true
  });

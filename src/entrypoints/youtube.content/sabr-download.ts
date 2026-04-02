/**
 * Download handler for the isolated world.
 *
 * Routes downloads through the background service worker which runs
 * SabrStream with host_permissions (no CORS) and session cookies.
 * Falls back to direct URL download via android_vr if SABR fails.
 */

import { MessageType, sendMessage } from "@/lib/messaging";
import { downloadProgressStore, sabrCredentials } from "@/lib/synced-stores.svelte";
import type { DownloadRequest } from "@/types";

declare const ytcfg: {
  get(key: string): unknown;
} | undefined;

async function waitForPoToken(timeoutMs = 30_000) {
  const existing = sabrCredentials.value?.poToken;
  if (existing) {
    return existing;
  }

  return new Promise<string | null>(resolve => {
    let isResolved = false;

    const checkInterval = setInterval(() => {
      const token = sabrCredentials.value?.poToken;
      if (token) {
        isResolved = true;
        clearInterval(checkInterval);
        resolve(token);
      }
    }, 500);

    addEventListener("message", function handleMessage(e: MessageEvent) {
      if (e.data?.namespace !== "ytdl-sync" || e.data.key !== "sabr-credentials") {
        return;
      }

      const token = e.data.value?.poToken;
      if (token && !isResolved) {
        isResolved = true;
        clearInterval(checkInterval);
        removeEventListener("message", handleMessage);
        resolve(token);
      }
    });

    setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        clearInterval(checkInterval);
        resolve(null);
      }
    }, timeoutMs);
  });
}

async function getAndroidVrFormats(videoId: string) {
  const visitorData = typeof ytcfg !== "undefined"
    ? String(ytcfg.get("VISITOR_DATA") ?? "")
    : "";

  const response = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Visitor-Id": visitorData
    },
    body: JSON.stringify({
      videoId,
      context: {
        client: {
          clientName: "ANDROID_VR",
          clientVersion: "1.65.10",
          androidSdkVersion: 34,
          osName: "Android",
          osVersion: "14",
          platform: "MOBILE"
        }
      },
      contentCheckOk: true,
      racyCheckOk: true
    })
  });

  const data = await response.json();
  if (data.playabilityStatus?.status !== "OK") {
    return null;
  }

  return data.streamingData?.adaptiveFormats ?? [];
}

export function listenForDownloadRequests() {
  addEventListener("message", e => {
    if (e.data?.namespace !== "ytdl-sync" || e.data.key !== "download-request") {
      return;
    }

    const request: DownloadRequest | null = e.data.value;
    if (!request?.videoId) {
      return;
    }

    handleDownload(request);
  });
}

async function handleDownload(request: DownloadRequest) {
  // Strategy 1: Background SabrStream (future-proof, uses YouTube's SABR protocol)
  if (request.sabrConfig) {
    const poToken = await waitForPoToken(10_000);
    if (poToken) {
      try {
        const isSuccess = await sendMessage(MessageType.SabrDownload, { request, poToken });
        if (isSuccess) {
          return;
        }
      } catch {
        // SabrStream failed - fall through to android_vr
      }
    }
  }

  // Strategy 2: Direct URL download via android_vr (fallback)
  try {
    const formats = await getAndroidVrFormats(request.videoId);
    if (!formats?.length) {
      downloadProgressStore.delete(request.videoId);
      return;
    }

    const videoFormat = formats.find(
      (format: { itag: number }) => format.itag === request.videoItag
    ) ?? formats.find(
      (format: { mimeType?: string }) => format.mimeType?.startsWith("video")
    );
    const audioFormat = formats.find(
      (format: { itag: number }) => format.itag === request.audioItag
    ) ?? formats.find(
      (format: { mimeType?: string }) => format.mimeType?.startsWith("audio")
    );

    const videoUrl = request.type !== "audio" ? videoFormat?.url : null;
    const audioUrl = request.type !== "video" ? audioFormat?.url : null;
    if (!videoUrl && !audioUrl) {
      downloadProgressStore.delete(request.videoId);
      return;
    }

    // Broadcast to MAIN world for direct fetch (YouTube's SW handles CORS)
    postMessage({
      namespace: "ytdl-sync",
      key: "direct-download-request",
      value: {
        videoId: request.videoId,
        videoItag: request.videoItag,
        audioItag: request.audioItag,
        filenameOutput: request.filenameOutput,
        type: request.type
      }
    }, "*");
  } catch {
    downloadProgressStore.delete(request.videoId);
  }
}

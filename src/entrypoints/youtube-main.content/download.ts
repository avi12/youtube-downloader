import { capturedPoToken, capturedSabrUrl, setPoTokenCredentials } from "./credentials";
import { fetchViaSabrStream, fetchAudioViaSabrStream } from "./sabr";
import { fetchStreamFromUrl, resolveFormatUrl, assembleChunks } from "./stream-fetch";
import { videoDataCache, buildVideoMetadata, captureState } from "./video-data";
import { crossWorldMessenger, CrossWorldMessage } from "@/lib/cross-world-messenger";
import { sabrCredentials } from "@/lib/synced-stores.svelte";
import { type AdaptiveFormatItem, type DownloadRequest, DownloadType, ProgressType } from "@/types";

interface StreamDataEvent {
  type: DownloadType;
  videoId: string;
  filenameOutput: string;
  videoData: Uint8Array | null;
  audioData: Uint8Array | null;
  videoMimeType: string;
  audioMimeType: string;
  audioLabel: string;
  additionalAudioData: Array<{
    data: Uint8Array | null;
    mimeType: string;
    label: string;
  }>;
}

const activeDownloads = new Map<string, AbortController>();

export function cancelActiveDownload(videoId: string) {
  const controller = activeDownloads.get(videoId);
  if (controller) {
    controller.abort();
    activeDownloads.delete(videoId);
  }
}

function getExtraAudioFormats(
  audioFormats: AdaptiveFormatItem[],
  selectedTrackId: string | undefined
) {
  if (!selectedTrackId) {
    return [];
  }

  // audioFormats is sorted by bitrate desc, so first per unique audioTrack.id = best quality.
  const seenTrackIds = new Set([selectedTrackId]);
  return audioFormats.filter(format => {
    const trackId = format.audioTrack?.id;
    if (!trackId || seenTrackIds.has(trackId)) {
      return false;
    }

    seenTrackIds.add(trackId);
    return true;
  });
}

function dispatchStreamData({
  type, videoId, filenameOutput,
  videoData, audioData, videoMimeType, audioMimeType,
  audioLabel, additionalAudioData
}: StreamDataEvent) {
  void crossWorldMessenger.sendMessage(CrossWorldMessage.StreamData, {
    downloadType: type,
    videoId,
    filenameOutput,
    videoData,
    audioData,
    videoMimeType,
    audioMimeType,
    audioLabel,
    additionalAudioData,
    metadata: buildVideoMetadata(videoId)
  });
}

// SABR fetches are proxied through the background SW, which has host_permissions
// for googlevideo.com and bypasses CORS without preflight. Direct content script
// fetches to googlevideo.com are blocked by CORS because the browser only adds
// sec-fetch-storage-access: active for YouTube's own player, not extension scripts.
const sabrBodyChunkSize = 8192;

// Creates a fetch function that proxies requests through the background SW and
// optionally reports download progress based on bytes received vs. expected total.
// Pass totalExpectedBytes=0 to skip progress reporting (e.g. for extra audio tracks).
async function createSabrFetch(videoId: string, totalExpectedBytes: number) {
  let receivedBytes = 0;

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");

    let bodyBase64 = "";
    if (init?.body) {
      const bodyBuffer = await new Response(init.body).arrayBuffer();
      const bodyBytes = new Uint8Array(bodyBuffer);
      let binary = "";
      for (let byteOffset = 0; byteOffset < bodyBytes.length; byteOffset += sabrBodyChunkSize) {
        binary += String.fromCharCode(...bodyBytes.subarray(byteOffset, byteOffset + sabrBodyChunkSize));
      }

      bodyBase64 = btoa(binary);
    }

    const headers: Record<string, string> = {};
    const headersInit = init?.headers ?? (input instanceof Request ? input.headers : undefined);
    if (headersInit) {
      for (const [key, value] of new Headers(headersInit)) {
        headers[key] = value;
      }
    }

    const result = await crossWorldMessenger.sendMessage(CrossWorldMessage.ProxyFetch, {
      url,
      method,
      bodyBase64,
      headers
    });
    if (!result) {
      throw new Error("[ytdl] Proxy fetch failed");
    }

    const responseBinary = atob(result.bodyBase64);
    const responseBytes = new Uint8Array(responseBinary.length);
    for (let byteIndex = 0; byteIndex < responseBinary.length; byteIndex++) {
      responseBytes[byteIndex] = responseBinary.charCodeAt(byteIndex);
    }

    if (totalExpectedBytes > 0) {
      receivedBytes += responseBytes.length;
      void crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadProgress, {
        videoId,
        progress: Math.min(receivedBytes / totalExpectedBytes, 1),
        progressType: ProgressType.Video
      });
    }

    return new Response(responseBytes, {
      status: result.status,
      headers: result.responseHeaders
    });
  };
}

function dispatchStreamError(videoId: string, error: string) {
  void crossWorldMessenger.sendMessage(CrossWorldMessage.StreamError, {
    videoId,
    error
  });
}

export async function performDownload({
  type,
  videoId,
  videoItag,
  audioItag,
  filenameOutput
}: Pick<DownloadRequest, "type" | "videoId" | "videoItag" | "audioItag" | "filenameOutput">) {
  cancelActiveDownload(videoId);
  const abortController = new AbortController();
  activeDownloads.set(videoId, abortController);
  const { signal } = abortController;

  try {
    const cachedVideoData = videoDataCache.get(videoId);
    if (!cachedVideoData) {
      console.error("[ytdl] No video data cached for", videoId);
      return;
    }

    const videoFormat = type !== DownloadType.Audio
      ? (cachedVideoData.videoFormats.find(format => format.itag === videoItag) ?? cachedVideoData.videoFormats[0])
      : null;
    const audioFormat = type !== DownloadType.Video
      ? (cachedVideoData.audioFormats.find(format => format.itag === audioItag) ?? cachedVideoData.audioFormats[0])
      : null;

    const videoMimeType = videoFormat?.mimeType.split(";")[0] ?? "video/mp4";
    const audioMimeType = audioFormat?.mimeType.split(";")[0] ?? "audio/mp4";
    const audioLabel = audioFormat?.audioTrack?.displayName ?? "";
    const extraAudioFormats = getExtraAudioFormats(cachedVideoData.audioFormats, audioFormat?.audioTrack?.id);

    // Strategy 1: SabrStream - independently fetch the full video without
    // relying on playback state. Works even if the video is paused.
    // Read SABR credentials from synced signal or DOM fallback.
    // The postMessage from the isolated world may arrive before the
    // MAIN world's listener is ready, so also check the DOM element
    // that sabr-credentials.ts writes as a persistent fallback.
    const creds = sabrCredentials.value;
    let currentPoToken = capturedPoToken;
    let currentSabrUrl = capturedSabrUrl;
    if (creds?.url) {
      currentSabrUrl = creds.url;
    }

    // Only fall back to captured token if BotGuard didn't generate one —
    // the captured protobuf token is truncated (15 bytes) and unusable for SABR auth.
    if (!currentPoToken && creds?.poToken) {
      currentPoToken = creds.poToken;
    }

    if (!currentPoToken || !currentSabrUrl) {
      const elCredentials = document.getElementById("ytdl-sabr-credentials");
      if (elCredentials?.dataset.url) {
        currentSabrUrl = elCredentials.dataset.url;
      }

      if (!currentPoToken && elCredentials?.dataset.poToken) {
        currentPoToken = elCredentials.dataset.poToken;
      }
    }

    if (currentPoToken !== capturedPoToken || currentSabrUrl !== capturedSabrUrl) {
      setPoTokenCredentials(currentPoToken, currentSabrUrl);
    }

    // Audio-only downloads (e.g. music) need fetchAudioViaSabrStream since videoFormat is null.
    // VideoAndAudio downloads use fetchViaSabrStream which fetches both streams together.
    const isAudioOnly = type === DownloadType.Audio;
    const canUseSabr = Boolean(cachedVideoData.sabrConfig && audioFormat && (isAudioOnly || videoFormat));
    if (canUseSabr) {
      try {
        console.log("[ytdl] Fetching via SabrStream (independent of playback)");

        // Prefer the webRequest-captured SABR URL (has full signature params like sig=, lsig=, spc=)
        // over the base serverAbrStreamingUrl from ytInitialPlayerResponse (lacks auth params).
        const sabrConfig = cachedVideoData.sabrConfig!;
        const effectiveSabrConfig = currentSabrUrl && currentSabrUrl !== sabrConfig.serverAbrStreamingUrl
          ? { ...sabrConfig, serverAbrStreamingUrl: currentSabrUrl }
          : sabrConfig;

        let primaryVideoData: Uint8Array | null = null;
        let primaryAudioData: Uint8Array;
        let additionalAudioData: Array<{
          data: Uint8Array | null; mimeType: string; label: string;
        }>;
        if (isAudioOnly) {
          const audioExpectedBytes = audioFormat!.contentLength ? parseInt(audioFormat!.contentLength, 10) : 0;
          const sabrFetch = await createSabrFetch(videoId, audioExpectedBytes);
          primaryAudioData = await fetchAudioViaSabrStream(
            effectiveSabrConfig,
            audioFormat!,
            sabrFetch,
            currentPoToken
          );
          console.log(`[ytdl] SabrStream done: audio=${primaryAudioData.byteLength}`);
          additionalAudioData = [];
        } else {
          const videoExpectedBytes = videoFormat!.contentLength ? parseInt(videoFormat!.contentLength, 10) : 0;
          const audioExpectedBytes = audioFormat!.contentLength ? parseInt(audioFormat!.contentLength, 10) : 0;
          const sabrFetch = await createSabrFetch(videoId, videoExpectedBytes + audioExpectedBytes);

          const primaryResult = await fetchViaSabrStream(
            effectiveSabrConfig,
            videoFormat!,
            audioFormat!,
            sabrFetch,
            currentPoToken
          );
          console.log(`[ytdl] SabrStream done: video=${primaryResult.videoData.byteLength} audio=${primaryResult.audioData.byteLength}`);
          primaryVideoData = primaryResult.videoData;
          primaryAudioData = primaryResult.audioData;

          // Fetch additional audio tracks in parallel (no progress tracking for extra tracks)
          additionalAudioData = (await Promise.all(extraAudioFormats.map(async format => {
            try {
              const audioData = await fetchAudioViaSabrStream(
                effectiveSabrConfig,
                format,
                await createSabrFetch(videoId, 0),
                currentPoToken
              );

              return {
                data: audioData,
                mimeType: format.mimeType.split(";")[0] ?? "audio/mp4",
                label: format.audioTrack?.displayName ?? ""
              };
            } catch (trackError) {
              console.warn("[ytdl] Extra audio track failed:", format.audioTrack?.displayName, trackError);
              return null;
            }
          }))).filter((track): track is NonNullable<typeof track> => track !== null);
        }

        dispatchStreamData({
          type,
          videoId,
          filenameOutput,
          videoData: type !== DownloadType.Audio ? primaryVideoData : null,
          audioData: primaryAudioData,
          videoMimeType,
          audioMimeType,
          audioLabel,
          additionalAudioData
        });

        captureState.capturedMedia.delete(videoId);
        document.dispatchEvent(new CustomEvent("ytdl:clear-interrupted", { detail: { videoId } }));
        return;
      } catch (sabrError) {
        console.warn("[ytdl] SabrStream failed, trying fallback:", sabrError);
        document.dispatchEvent(new CustomEvent("ytdl:persist-interrupted", {
          detail: {
            videoId,
            type,
            filenameOutput,
            videoItag,
            audioItag,
            timestamp: Date.now()
          }
        }));
      }
    }

    // Strategy 2: CDN fetch with signature decryption.
    // Formats either have a direct `url` or an encrypted `signatureCipher`.
    // Decrypt signatureCipher using the transformation sequence from player.js.
    const hasDownloadableFormats = videoFormat?.url || videoFormat?.signatureCipher
      || audioFormat?.url || audioFormat?.signatureCipher;
    if (hasDownloadableFormats) {
      try {
        const [resolvedVideoUrl, resolvedAudioUrl, ...resolvedExtraUrls] = await Promise.all([
          type !== DownloadType.Audio ? resolveFormatUrl(videoFormat) : Promise.resolve(null),
          type !== DownloadType.Video ? resolveFormatUrl(audioFormat) : Promise.resolve(null),
          ...extraAudioFormats.map(format => resolveFormatUrl(format))
        ]);
        if (!resolvedVideoUrl && !resolvedAudioUrl) {
          console.warn("[ytdl] Could not resolve any format URLs");
        } else {
          let totalExpectedBytes = 0;
          let totalReceivedBytes = 0;

          function reportDownloadProgress(receivedBytes: number, totalBytes: number) {
            totalExpectedBytes = Math.max(totalExpectedBytes, totalBytes);
            totalReceivedBytes = receivedBytes;

            if (totalExpectedBytes > 0) {
              void crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadProgress, {
                videoId,
                progress: Math.min(totalReceivedBytes / totalExpectedBytes, 1),
                progressType: ProgressType.Video
              });
            }
          }

          function fetchOrNull(url: string | null) {
            return url ? fetchStreamFromUrl(url, reportDownloadProgress, signal) : null;
          }

          const [videoBytes, audioBytes, ...extraAudioBytes] = await Promise.all([
            fetchOrNull(resolvedVideoUrl),
            fetchOrNull(resolvedAudioUrl),
            ...resolvedExtraUrls.map(fetchOrNull)
          ]);

          const additionalAudioData = extraAudioFormats.map((format, i) => ({
            data: extraAudioBytes[i] ?? null,
            mimeType: format.mimeType.split(";")[0] ?? "audio/mp4",
            label: format.audioTrack?.displayName ?? `Track ${i + 2}`
          }));

          dispatchStreamData({
            type,
            videoId,
            filenameOutput,
            videoData: videoBytes,
            audioData: audioBytes,
            videoMimeType,
            audioMimeType,
            audioLabel,
            additionalAudioData
          });
          return;
        }
      } catch (cdnError) {
        console.warn("[ytdl] CDN fetch failed, trying SourceBuffer fallback:", cdnError);
      }
    }

    // Strategy 3: SourceBuffer capture - play the video at accelerated speed.
    // Use 4x (not 16x) so the buffer can keep up with the network.
    // Handle buffer underruns by waiting and resuming playback.
    const elVideoNullable = document.querySelector<HTMLVideoElement>("video");
    if (elVideoNullable && !elVideoNullable.ended) {
      // Capture as a non-null const so TypeScript preserves the type inside closures
      const elVideo = elVideoNullable;
      elVideo.playbackRate = 4;
      elVideo.muted = true;
      elVideo.play().catch(() => {});

      console.log("[ytdl] SourceBuffer fallback: playing at 4x to capture full video");

      await new Promise<void>(resolve => {
        let isResolved = false;

        function done() {
          if (isResolved) {
            return;
          }

          isResolved = true;
          elVideo.removeEventListener("ended", done);
          elVideo.playbackRate = 1;
          resolve();
        }

        elVideo.addEventListener("ended", done);
        signal.addEventListener("abort", done, { once: true });

        // Handle buffer underruns: YouTube pauses when buffer runs dry.
        // Poll and resume playback until the video ends.
        const resumeInterval = setInterval(() => {
          if (elVideo.ended || isResolved) {
            clearInterval(resumeInterval);
            done();
            return;
          }

          if (elVideo.paused) {
            elVideo.play().catch(() => {});
          }
        }, 2000);

        // Safety timeout: max 10 min
        setTimeout(() => {
          clearInterval(resumeInterval);
          done();
        }, 10 * 60 * 1000);
      });
    }

    // Give SourceBuffer a moment to flush final chunks
    await new Promise(resolve => setTimeout(resolve, 2000));

    const { capturedMedia } = captureState;
    const capture = capturedMedia.get(videoId);
    if (capture && (capture.videoTotalBytes > 0 || capture.audioTotalBytes > 0)) {
      const videoBytes = assembleChunks(capture.videoChunks, capture.videoTotalBytes);
      const audioBytes = assembleChunks(capture.audioChunks, capture.audioTotalBytes);
      console.log(`[ytdl] SourceBuffer fallback: video=${videoBytes.byteLength} audio=${audioBytes.byteLength}`);

      dispatchStreamData({
        type,
        videoId,
        filenameOutput,
        videoData: videoBytes,
        audioData: audioBytes,
        videoMimeType: capture.videoMimeType,
        audioMimeType: capture.audioMimeType,
        audioLabel,
        additionalAudioData: []
      });

      capturedMedia.delete(videoId);
      return;
    }

    // All strategies failed - persist as interrupted so user can resume later
    document.dispatchEvent(new CustomEvent("ytdl:persist-interrupted", {
      detail: {
        videoId,
        type,
        filenameOutput,
        videoItag,
        audioItag,
        timestamp: Date.now()
      }
    }));

    dispatchStreamError(videoId, "No download method available - try reloading the page");
  } catch (error) {
    if (signal.aborted) {
      return;
    }

    throw error;
  } finally {
    activeDownloads.delete(videoId);
  }
}

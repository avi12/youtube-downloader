import { sendStreamChunksToOffscreen } from "./offscreen-transfer";
import { ensureProcessor } from "./processor";
import { createProgressFetch, fetchWithProgress, sendProgressUpdate } from "./progress-fetch";
import { fetchYouTubeMusicMetadata } from "./youtube-music-metadata";
import { MessageType, sendMessage } from "@/lib/messaging";
import { fetchAudioViaSabrStream, fetchVideoViaSabrStream } from "@/lib/sabr-download";
import { DownloadType, ProgressType, StreamType } from "@/types";
import type { DownloadRequest, SabrConfig } from "@/types";

const activeBackgroundDownloads = new Map<string, AbortController>();

export function cancelBackgroundDownload(videoId: string) {
  const controller = activeBackgroundDownloads.get(videoId);
  if (!controller) {
    return;
  }

  controller.abort();
  activeBackgroundDownloads.delete(videoId);
}

function buildEffectiveSabrConfig(sabrConfig: SabrConfig, sabrUrl: string | undefined): SabrConfig {
  if (sabrUrl && sabrUrl !== sabrConfig.serverAbrStreamingUrl) {
    return { ...sabrConfig, serverAbrStreamingUrl: sabrUrl };
  }

  return sabrConfig;
}

export async function startBackgroundDownload(request: DownloadRequest, tabId: number) {
  const {
    videoId,
    type,
    filenameOutput,
    sabrConfig,
    poToken,
    sabrUrl,
    videoFormat,
    audioFormat,
    additionalAudioFormats,
    primaryAudioLabel,
    metadata,
    resolvedVideoUrl,
    resolvedAudioUrl,
    resolvedExtraAudioUrls,
    playlistId,
    playlistTitle,
    playlistTotalCount
  } = request;

  cancelBackgroundDownload(videoId);
  const abortController = new AbortController();
  activeBackgroundDownloads.set(videoId, abortController);
  const { signal } = abortController;

  try {
    const isAudioOnly = type === DownloadType.Audio;

    const musicSearchQuery = metadata ? `${metadata.artist} ${metadata.title}` : "";
    const enrichedMetadataPromise = metadata?.isMusic && musicSearchQuery.trim()
      ? fetchYouTubeMusicMetadata(musicSearchQuery, metadata)
      : Promise.resolve(metadata);

    const effectiveSabrConfig = sabrConfig
      ? buildEffectiveSabrConfig(sabrConfig, sabrUrl)
      : null;

    const canUseSabr = Boolean(
      effectiveSabrConfig && audioFormat && (isAudioOnly || videoFormat)
    );

    let primaryVideoData: Uint8Array | null = null;
    let primaryAudioData: Uint8Array | null = null;
    const additionalAudioData: Array<{
      data: Uint8Array | null; mimeType: string; label: string;
    }> = [];
    if (canUseSabr) {
      try {
        const resolvedPoToken = poToken ?? "";
        if (isAudioOnly) {
          const audioExpectedBytes = audioFormat!.contentLength
            ? parseInt(audioFormat!.contentLength, 10)
            : 0;
          let audioReceivedBytes = 0;

          const sabrFetch = createProgressFetch(signal, bytes => {
            audioReceivedBytes += bytes;
            const totalBytes = audioExpectedBytes || audioReceivedBytes;
            void sendProgressUpdate(
              videoId,
              Math.min(audioReceivedBytes / totalBytes, 1),
              ProgressType.Video,
              tabId
            );
          });

          primaryAudioData = await fetchAudioViaSabrStream(
            effectiveSabrConfig!,
            audioFormat!,
            sabrFetch,
            resolvedPoToken
          );
        } else {
          const videoExpectedBytes = videoFormat!.contentLength
            ? parseInt(videoFormat!.contentLength, 10)
            : 0;
          const audioExpectedBytes = audioFormat!.contentLength
            ? parseInt(audioFormat!.contentLength, 10)
            : 0;
          const totalExpectedBytes = videoExpectedBytes + audioExpectedBytes;
          let videoReceivedBytes = 0;
          let audioReceivedBytes = 0;

          function reportParallelProgress() {
            const totalReceived = videoReceivedBytes + audioReceivedBytes;
            const totalExpected = totalExpectedBytes || totalReceived;
            if (totalExpected === 0) {
              return;
            }

            void sendProgressUpdate(
              videoId,
              Math.min(totalReceived / totalExpected, 1),
              ProgressType.Video,
              tabId
            );
          }

          const videoSabrFetch = createProgressFetch(signal, bytes => {
            videoReceivedBytes += bytes;
            reportParallelProgress();
          });
          const audioSabrFetch = createProgressFetch(signal, bytes => {
            audioReceivedBytes += bytes;
            reportParallelProgress();
          });

          [primaryVideoData, primaryAudioData] = await Promise.all([
            fetchVideoViaSabrStream(effectiveSabrConfig!, videoFormat!, videoSabrFetch, resolvedPoToken),
            fetchAudioViaSabrStream(effectiveSabrConfig!, audioFormat!, audioSabrFetch, resolvedPoToken)
          ]);

          for (const format of additionalAudioFormats ?? []) {
            try {
              const extraSabrFetch = createProgressFetch(signal, () => {});
              const audioData = await fetchAudioViaSabrStream(
                effectiveSabrConfig!,
                format,
                extraSabrFetch,
                resolvedPoToken
              );
              additionalAudioData.push({
                data: audioData,
                mimeType: format.mimeType.split(";")[0] ?? "audio/mp4",
                label: format.audioTrack?.displayName ?? ""
              });
            } catch (trackError) {
              console.warn("[ytdl:bg] Extra audio track failed:", format.audioTrack?.displayName, trackError);
            }
          }
        }
      } catch (sabrError) {
        if (signal.aborted) {
          return;
        }

        console.warn("[ytdl:bg] SABR failed, trying CDN:", sabrError);

        primaryVideoData = null;
        primaryAudioData = null;
        additionalAudioData.length = 0;
      }
    }

    if (primaryAudioData === null && (resolvedVideoUrl || resolvedAudioUrl)) {
      try {
        const videoExpectedBytes = videoFormat?.contentLength
          ? parseInt(videoFormat.contentLength, 10)
          : 0;
        const audioExpectedBytes = audioFormat?.contentLength
          ? parseInt(audioFormat.contentLength, 10)
          : 0;
        let videoReceivedBytes = 0;
        let audioReceivedBytes = 0;
        let videoTotalBytes = videoExpectedBytes;
        let audioTotalBytes = audioExpectedBytes;

        function reportCdnProgress() {
          const totalReceived = videoReceivedBytes + audioReceivedBytes;
          const totalExpected = (videoTotalBytes + audioTotalBytes) || totalReceived;
          if (totalExpected === 0) {
            return;
          }

          void sendProgressUpdate(
            videoId,
            Math.min(totalReceived / totalExpected, 1),
            ProgressType.Video,
            tabId
          );
        }

        function fetchCdnStream(url: string | null | undefined, onBytes: (bytes: number) => void) {
          if (!url) {
            return Promise.resolve(null);
          }

          return fetchWithProgress(url, signal, onBytes);
        }

        const extraUrls = resolvedExtraAudioUrls ?? [];

        const cdnResults = await Promise.all([
          type !== DownloadType.Audio
            ? fetchCdnStream(resolvedVideoUrl, bytes => {
              videoReceivedBytes += bytes;
              videoTotalBytes = Math.max(videoTotalBytes, videoReceivedBytes);
              reportCdnProgress();
            })
            : Promise.resolve(null),
          type !== DownloadType.Video
            ? fetchCdnStream(resolvedAudioUrl, bytes => {
              audioReceivedBytes += bytes;
              audioTotalBytes = Math.max(audioTotalBytes, audioReceivedBytes);
              reportCdnProgress();
            })
            : Promise.resolve(null),
          ...extraUrls.map(url => fetchCdnStream(url, () => {}))
        ]);

        primaryVideoData = cdnResults[0] ?? null;
        primaryAudioData = cdnResults[1] ?? null;
        const extraAudioBytes = cdnResults.slice(2);

        for (const [i, format] of (additionalAudioFormats ?? []).entries()) {
          additionalAudioData.push({
            data: extraAudioBytes[i] ?? null,
            mimeType: format.mimeType.split(";")[0] ?? "audio/mp4",
            label: format.audioTrack?.displayName ?? `Track ${i + 2}`
          });
        }
      } catch (cdnError) {
        if (signal.aborted) {
          return;
        }

        console.warn("[ytdl:bg] CDN fetch failed:", cdnError);
        return;
      }
    }

    if (primaryAudioData === null && primaryVideoData === null) {
      console.warn("[ytdl:bg] No download method succeeded for", videoId);
      return;
    }

    await ensureProcessor();

    const resolvedVideoMimeType = videoFormat?.mimeType.split(";")[0] ?? "video/mp4";
    const resolvedAudioMimeType = audioFormat?.mimeType.split(";")[0] ?? "audio/mp4";

    const streamTasks: Promise<void>[] = [];
    if (primaryVideoData) {
      streamTasks.push(sendStreamChunksToOffscreen(videoId, StreamType.Video, primaryVideoData, tabId));
    }

    if (primaryAudioData) {
      streamTasks.push(sendStreamChunksToOffscreen(videoId, StreamType.Audio, primaryAudioData, tabId));
    }

    for (const [i, track] of additionalAudioData.entries()) {
      if (track.data) {
        streamTasks.push(sendStreamChunksToOffscreen(videoId, `audio-extra-${i}`, track.data, tabId));
      }
    }

    await Promise.all(streamTasks);

    const audioTrackLabels = [
      primaryAudioLabel ?? "",
      ...additionalAudioData.map(track => track.label)
    ];

    const enrichedMetadata = await enrichedMetadataPromise;

    await sendMessage(MessageType.ProcessStreamEnd, {
      type,
      videoId,
      filenameOutput,
      videoMimeType: resolvedVideoMimeType,
      audioMimeType: resolvedAudioMimeType,
      audioTrackLabels,
      tabId,
      playlistId,
      playlistTitle,
      playlistTotalCount,
      metadata: enrichedMetadata
    });
  } catch (error) {
    if (signal.aborted) {
      return;
    }

    console.warn("[ytdl:bg] Background download failed:", error);
  } finally {
    activeBackgroundDownloads.delete(videoId);
  }
}

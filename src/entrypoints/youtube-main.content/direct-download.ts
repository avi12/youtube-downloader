import { activeDownloads, cancelActiveDownload } from "./download";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/cross-world-messenger";
import { SYNC_NAMESPACE, SyncKey } from "@/lib/synced-stores.svelte";

export function registerDirectDownloadHandler() {
  addEventListener("message", async e => {
    if (e.data?.namespace !== SYNC_NAMESPACE || e.data.key !== SyncKey.DirectDownloadRequest) {
      return;
    }

    const {
      videoId: downloadVideoId, videoUrl, audioUrl,
      videoMimeType, audioMimeType, filenameOutput, type: downloadType
    } = e.data.value;

    cancelActiveDownload(downloadVideoId);
    const abortController = new AbortController();
    activeDownloads.set(downloadVideoId, abortController);
    const { signal } = abortController;

    try {
      let totalExpectedBytes = 0;
      let totalReceivedBytes = 0;

      async function fetchMediaData(url: string, streamType: string) {
        const response = await fetch(url, { signal });
        if (!response.ok) {
          throw new Error(`Media fetch failed: ${response.status}`);
        }

        const contentLength = Number(response.headers.get("content-length") ?? 0);
        totalExpectedBytes += contentLength;

        if (!response.body) {
          return new Uint8Array(await response.arrayBuffer());
        }

        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let receivedBytes = 0;

        while (true) {
          if (signal.aborted) {
            await reader.cancel();
            return null;
          }

          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          chunks.push(value);
          receivedBytes += value.byteLength;
          totalReceivedBytes += value.byteLength;

          // Report progress via synced signal
          if (totalExpectedBytes > 0) {
            postMessage({
              namespace: SYNC_NAMESPACE,
              key: SyncKey.DownloadProgress,
              value: {
                mapKey: downloadVideoId,
                mapValue: {
                  isDownloading: true,
                  isDone: false,
                  isQueued: false,
                  progress: totalReceivedBytes / totalExpectedBytes,
                  progressType: streamType
                }
              }
            }, location.origin);
          }
        }

        const result = new Uint8Array(receivedBytes);
        let writeOffset = 0;

        for (const chunk of chunks) {
          result.set(chunk, writeOffset);
          writeOffset += chunk.byteLength;
        }

        return result;
      }

      const [videoData, audioData] = await Promise.all([
        videoUrl ? fetchMediaData(videoUrl, "video") : Promise.resolve(null),
        audioUrl ? fetchMediaData(audioUrl, "audio") : Promise.resolve(null)
      ]);
      if (signal.aborted) {
        return;
      }

      void crossWorldMessenger.sendMessage(CrossWorldMessage.StreamData, {
        downloadType,
        videoId: downloadVideoId,
        filenameOutput,
        videoData: videoData ?? null,
        audioData: audioData ?? null,
        videoMimeType,
        audioMimeType,
        audioLabel: "",
        additionalAudioData: []
      });
    } catch (error) {
      if (signal.aborted) {
        return;
      }

      console.error("[ytdl] Direct download failed:", error);
      void crossWorldMessenger.sendMessage(CrossWorldMessage.StreamError, {
        videoId: downloadVideoId,
        error: String(error)
      });
    } finally {
      activeDownloads.delete(downloadVideoId);
    }
  });
}

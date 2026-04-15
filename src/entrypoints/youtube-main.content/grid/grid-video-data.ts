import { cancelActiveDownload } from "../video/download";
import { buildAndDispatchVideoData, videoDataCache, readYtcfg } from "../video/video-data";
import { extractPlayerResponseFromHtml } from "../video/youtube-api";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { videoDataStore } from "@/lib/ui/synced-stores.svelte";
import type { PlayerResponse } from "@/types";

declare const ytcfg: { get: (key: string) => unknown } | undefined;

const MAX_CONCURRENT_FETCHES = 3;
const videoDataPending = new Set<string>();
let activeVideoDataFetches = 0;

async function fetchVideoDataViaApi(videoId: string) {
  // /player returns UNPLAYABLE on non-watch pages, so fall back to scraping
  // ytInitialPlayerResponse from watch page HTML.
  const isWatchPage = location.pathname === "/watch";
  if (isWatchPage) {
    const { clientVersion, clientName } = readYtcfg();
    const visitorData = ytcfg?.get("VISITOR_DATA") ?? "";
    const signatureTimestamp = ytcfg?.get("STS");

    const response = await globalThis.fetch(
      "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Visitor-Id": String(visitorData)
        },
        body: JSON.stringify({
          videoId,
          context: {
            client: {
              clientName: clientName === 1 ? "WEB" : String(clientName),
              clientVersion: String(clientVersion)
            }
          },
          playbackContext: { contentPlaybackContext: { signatureTimestamp } },
          contentCheckOk: true,
          racyCheckOk: true
        })
      }
    );
    const playerData: PlayerResponse = await response.json();
    if (playerData?.videoDetails?.videoId) {
      await buildAndDispatchVideoData(playerData, cancelActiveDownload);
      return;
    }
  }

  const html = await (await globalThis.fetch(
    `https://www.youtube.com/watch?v=${videoId}`,
    { credentials: "include" }
  )).text();

  const playerResponse = extractPlayerResponseFromHtml(html);
  if (playerResponse?.videoDetails?.videoId) {
    await buildAndDispatchVideoData(playerResponse, cancelActiveDownload);
  }
}

async function processNextVideoData() {
  if (activeVideoDataFetches >= MAX_CONCURRENT_FETCHES || videoDataPending.size === 0) {
    return;
  }

  const { value: videoId } = videoDataPending.values().next();
  if (!videoId) {
    return;
  }

  videoDataPending.delete(videoId);
  activeVideoDataFetches++;

  try {
    await fetchVideoDataViaApi(videoId);
  } catch (error) {
    console.warn("[ytdl] Failed to fetch video data for", videoId, error);
  } finally {
    activeVideoDataFetches--;
    void processNextVideoData();
  }
}

function requestVideoData(videoId: string) {
  if (videoDataCache.has(videoId)) {
    videoDataStore.set(videoId, videoDataCache.get(videoId)!);
    return;
  }

  if (!videoDataPending.has(videoId)) {
    videoDataPending.add(videoId);
    void processNextVideoData();
  }
}

export function registerGridVideoDataHandler() {
  crossWorldMessenger.onMessage(CrossWorldMessage.RequestVideoData, ({ data }) => {
    requestVideoData(data.videoId);
  });
}

import { cancelActiveDownload } from "../video/download";
import { buildAndDispatchVideoData, videoDataCache, readYtcfg } from "../video/video-data";
import { extractPlayerResponseFromHtml } from "../video/youtube-api";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { videoDataFailedStore, videoDataStore } from "@/lib/ui/synced-stores.svelte";
import { InnertubeClientName, type InnertubePlayerRequest } from "@/lib/youtube/innertube";
import { getYtcfg, YtcfgKey } from "@/lib/youtube/ytcfg";
import type { PlayerResponse } from "@/types";

const MAX_CONCURRENT_FETCHES = 3;
const videoDataPending = new Set<string>();
let activeVideoDataFetches = 0;

async function fetchVideoDataViaApi(videoId: string) {
  // /player returns UNPLAYABLE on non-watch pages, so fall back to scraping
  // ytInitialPlayerResponse from watch page HTML.
  const isWatchPage = location.pathname === "/watch";
  if (isWatchPage) {
    const { clientVersion, clientName } = readYtcfg();
    const visitorData = getYtcfg(YtcfgKey.VisitorData) ?? "";
    const signatureTimestamp = getYtcfg(YtcfgKey.Sts);

    const response = await fetch(
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
              clientName: clientName === 1 ? InnertubeClientName.Web : String(clientName),
              clientVersion: String(clientVersion)
            }
          },
          playbackContext: {
            contentPlaybackContext: { signatureTimestamp }
          },
          contentCheckOk: true,
          racyCheckOk: true
        } satisfies InnertubePlayerRequest)
      }
    );
    const playerData: PlayerResponse = await response.json();
    if (playerData?.videoDetails?.videoId) {
      await buildAndDispatchVideoData({
        playerResponse: playerData,
        cancelActiveDownload
      });
      return;
    }
  }

  const html = await (await fetch(
    `https://www.youtube.com/watch?v=${videoId}`,
    { credentials: "include" }
  )).text();

  const playerResponse = extractPlayerResponseFromHtml(html);
  if (playerResponse?.videoDetails?.videoId) {
    await buildAndDispatchVideoData({
      playerResponse,
      cancelActiveDownload
    });
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

    if (!videoDataCache.has(videoId)) {
      videoDataFailedStore.set(videoId, true);
    }
  } catch (error) {
    console.warn("[ytdl] Failed to fetch video data for", videoId, error);
    videoDataFailedStore.set(videoId, true);
  } finally {
    activeVideoDataFetches--;
    void processNextVideoData();
  }
}

function requestVideoData(videoId: string) {
  const cachedVideoData = videoDataCache.get(videoId);
  if (cachedVideoData) {
    videoDataStore.set(videoId, cachedVideoData);
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

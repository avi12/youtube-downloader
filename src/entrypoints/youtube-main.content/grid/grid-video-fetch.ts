import { buildAndDispatchVideoData } from "../video/capture-dispatch";
import { readYtcfg } from "../video/video-data";
import { extractPlayerResponseFromHtml } from "../video/youtube-api";
import { InnertubeClientName, type InnertubePlayerRequest } from "@/lib/youtube/innertube";
import { getYtcfg, YtcfgKey } from "@/lib/youtube/ytcfg";
import type { PlayerResponse } from "@/types";

export async function fetchVideoDataViaApi(videoId: string) {
  const isWatchPage = location.pathname === "/watch";
  if (isWatchPage) {
    const { clientVersion, clientName } = readYtcfg();
    const visitorData = getYtcfg(YtcfgKey.VisitorData) ?? "";
    const signatureTimestamp = getYtcfg(YtcfgKey.Sts);

    const playerRequest: InnertubePlayerRequest = {
      videoId,
      context: {
        client: {
          clientName: clientName === 1 ? InnertubeClientName.Web : String(clientName),
          clientVersion: String(clientVersion)
        }
      },
      playbackContext: {
        contentPlaybackContext: {
          signatureTimestamp
        }
      },
      contentCheckOk: true,
      racyCheckOk: true
    };
    const response = await fetch(
      "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Visitor-Id": String(visitorData)
        },
        body: JSON.stringify(playerRequest)
      }
    );
    const playerData: PlayerResponse = await response.json();
    if (playerData?.videoDetails?.videoId) {
      await buildAndDispatchVideoData({ playerResponse: playerData });
      return;
    }
  }

  const html = await (await fetch(
    `https://www.youtube.com/watch?v=${videoId}`,
    { credentials: "include" }
  )).text();

  const playerResponse = extractPlayerResponseFromHtml(html);
  if (playerResponse?.videoDetails?.videoId) {
    await buildAndDispatchVideoData({ playerResponse });
  }
}

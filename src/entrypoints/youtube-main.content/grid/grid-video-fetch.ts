import { buildAndDispatchVideoData } from "../video/capture-dispatch";
import { readYtcfg } from "../video/video-data";
import { extractPlayerResponseFromHtml } from "../video/youtube-api";
import { InnertubeClientName, type InnertubePlayerRequest } from "@/lib/youtube/innertube";
import { getYtcfg, YtcfgKey } from "@/lib/youtube/ytcfg";
import type { PlayerResponse } from "@/types";

const WATCH_PATHNAME = "/watch";
const PLAYER_API_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
const YT_WATCH_URL_PREFIX = "https://www.youtube.com/watch?v=";
const HEADER_CONTENT_TYPE = "Content-Type";
const HEADER_GOOG_VISITOR_ID = "X-Goog-Visitor-Id";
const CONTENT_TYPE_JSON = "application/json";

export async function fetchVideoDataViaApi(videoId: string) {
  const isWatchPage = location.pathname === WATCH_PATHNAME;
  if (isWatchPage) {
    const { clientVersion, clientName } = readYtcfg();
    const visitorData = getYtcfg(YtcfgKey.VisitorData) ?? "";
    const signatureTimestamp = getYtcfg(YtcfgKey.Sts);
    const isDefaultWebClient = clientName === 1;

    const response = await fetch(
      PLAYER_API_URL,
      {
        method: "POST",
        credentials: "include",
        headers: {
          [HEADER_CONTENT_TYPE]: CONTENT_TYPE_JSON,
          [HEADER_GOOG_VISITOR_ID]: String(visitorData)
        },
        body: JSON.stringify({
          videoId,
          context: {
            client: {
              clientName: isDefaultWebClient ? InnertubeClientName.Web : String(clientName),
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
        } satisfies InnertubePlayerRequest)
      }
    );
    const playerData: PlayerResponse = await response.json();
    const hasPlayerDataVideoId = !!playerData?.videoDetails?.videoId;
    if (hasPlayerDataVideoId) {
      await buildAndDispatchVideoData({ playerResponse: playerData });
      return;
    }
  }

  const html = await (await fetch(
    `${YT_WATCH_URL_PREFIX}${videoId}`,
    { credentials: "include" }
  )).text();

  const playerResponse = extractPlayerResponseFromHtml(html);
  const hasPlayerResponseVideoId = !!playerResponse?.videoDetails?.videoId;
  if (hasPlayerResponseVideoId) {
    await buildAndDispatchVideoData({ playerResponse });
  }
}

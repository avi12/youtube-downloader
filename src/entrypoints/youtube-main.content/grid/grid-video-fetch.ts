import { buildAndDispatchVideoData } from "../video/capture-dispatch";
import { readYtcfg } from "../video/video-data";
import { extractPlayerResponseFromHtml } from "../video/youtube-api";
import { InnertubeClientName, type InnertubePlayerRequest } from "@/lib/youtube/innertube";
import { playerResponseSchema } from "@/lib/youtube/schemas";
import { getYtcfg, YtcfgKey } from "@/lib/youtube/ytcfg";
import type { PlayerResponse } from "@/types";

const PLAYER_API_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
const YT_WATCH_URL_PREFIX = "https://www.youtube.com/watch?v=";
const HEADER_CONTENT_TYPE = "Content-Type";
const HEADER_GOOG_VISITOR_ID = "X-Goog-Visitor-Id";
const CONTENT_TYPE_JSON = "application/json";

function buildPlayerRequest(videoId: string): InnertubePlayerRequest {
  const { clientVersion, clientName } = readYtcfg();
  const signatureTimestamp = getYtcfg(YtcfgKey.Sts);
  const isDefaultWebClient = clientName === 1;

  return {
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
  };
}

function withVideoId(playerResponse: PlayerResponse | null | undefined) {
  return playerResponse?.videoDetails?.videoId ? playerResponse : null;
}

async function fetchPlayerResponseViaApi(videoId: string) {
  const visitorData = getYtcfg(YtcfgKey.VisitorData) ?? "";

  const response = await fetch(
    PLAYER_API_URL,
    {
      method: "POST",
      credentials: "include",
      headers: {
        [HEADER_CONTENT_TYPE]: CONTENT_TYPE_JSON,
        [HEADER_GOOG_VISITOR_ID]: String(visitorData)
      },
      body: JSON.stringify(buildPlayerRequest(videoId))
    }
  );

  const parsed = playerResponseSchema.safeParse(await response.json());
  return parsed.success ? withVideoId(parsed.data) : null;
}

async function fetchPlayerResponseViaHtml(videoId: string) {
  const html = await (await fetch(
    `${YT_WATCH_URL_PREFIX}${videoId}`,
    { credentials: "include" }
  )).text();

  return withVideoId(extractPlayerResponseFromHtml(html));
}

export async function fetchVideoDataViaApi(videoId: string) {
  const playerResponse =
    (await fetchPlayerResponseViaApi(videoId).catch(() => null)) ?? (await fetchPlayerResponseViaHtml(videoId));
  if (playerResponse) {
    await buildAndDispatchVideoData({ playerResponse });
  }
}

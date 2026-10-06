import { uint8ToBase64 } from "@/lib/utils/binary";
import { getVideoIdFromUrl } from "@/lib/youtube/youtube-url";
import type { DownloadRequest, Prettify } from "@/types";
import { VideoPlaybackAbrRequest } from "googlevideo/protos";

// The player's first SABR request carries a short cold-start placeholder; only the
// BotGuard-minted token that follows it is accepted past SABR's attestation grace period.
const MIN_ATTESTED_PO_TOKEN_BYTES = 32;
const REQUEST_NUMBER_PARAM = "rn";

type PlayerSession = Prettify<{
  videoId: string;
  serverAbrStreamingUrl: string;
  videoPlaybackUstreamerConfig: string;
  poToken: string;
}>;

const sessionsByTab = new Map<number, PlayerSession>();

type RecordPlayerSessionParams = Prettify<{
  tabId: number;
  url: string;
  body: Uint8Array;
}>;
export async function recordPlayerSession({ tabId, url, body }: RecordPlayerSessionParams) {
  const request = VideoPlaybackAbrRequest.decode(body);
  const poToken = request.streamerContext?.poToken;
  const ustreamerConfig = request.videoPlaybackUstreamerConfig;
  const isAttested = (poToken?.byteLength ?? 0) >= MIN_ATTESTED_PO_TOKEN_BYTES;
  if (!isAttested || !ustreamerConfig?.byteLength) {
    return;
  }

  const tab = await browser.tabs.get(tabId).catch(() => null);
  const videoId = tab?.url ? getVideoIdFromUrl(tab.url) : null;
  if (!videoId) {
    return;
  }

  const streamingUrl = new URL(url);
  streamingUrl.searchParams.delete(REQUEST_NUMBER_PARAM);
  sessionsByTab.set(tabId, {
    videoId,
    serverAbrStreamingUrl: streamingUrl.href,
    videoPlaybackUstreamerConfig: uint8ToBase64(ustreamerConfig),
    poToken: uint8ToBase64(poToken!)
  });
}

type GetPlayerSessionParams = Prettify<{
  tabId: number;
  videoId: string;
}>;
function getPlayerSession({ tabId, videoId }: GetPlayerSessionParams) {
  const session = sessionsByTab.get(tabId);
  return session?.videoId === videoId ? session : null;
}

export function clearPlayerSession(tabId: number) {
  sessionsByTab.delete(tabId);
}

type WithPlayerSessionParams = Prettify<{
  request: DownloadRequest;
  tabId: number;
}>;
export function withPlayerSession({ request, tabId }: WithPlayerSessionParams) {
  const session = getPlayerSession({
    tabId,
    videoId: request.videoId
  });
  if (!session || !request.sabrConfig) {
    return request;
  }

  return {
    ...request,
    sabrConfig: {
      ...request.sabrConfig,
      serverAbrStreamingUrl: session.serverAbrStreamingUrl,
      videoPlaybackUstreamerConfig: session.videoPlaybackUstreamerConfig
    },
    sabrUrl: session.serverAbrStreamingUrl,
    poToken: session.poToken
  };
}

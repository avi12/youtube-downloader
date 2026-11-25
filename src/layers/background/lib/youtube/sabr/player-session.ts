import { required } from "@/lib/required";
import { uint8ToBase64 } from "@/lib/utils/binary";
import { getVideoIdFromUrl } from "@/lib/youtube/youtube-url";
import type { DownloadRequest, Prettify } from "@/types";
import { VideoPlaybackAbrRequest } from "googlevideo/protos";

// The player's first SABR request carries a short cold-start placeholder; only the
// BotGuard-minted token that follows it is accepted past SABR's attestation grace period.
const MIN_ATTESTED_PO_TOKEN_BYTES = 32;
const REQUEST_NUMBER_PARAM = "rn";
const FRAME_SESSION_TIMEOUT_MS = 20_000;

type PlayerSession = Prettify<{
  videoId: string;
  serverAbrStreamingUrl: string;
  videoPlaybackUstreamerConfig: string;
  poToken: string;
}>;

const sessionsByTab = new Map<number, PlayerSession>();
// Hidden download frames have no tab, so they are told apart by frame: the frame's own navigation
// names its video, and its player's SABR requests carry the same frame id
const sessionsByVideo = new Map<string, PlayerSession>();
const videoIdsByFrame = new Map<number, string>();
const sessionWaiters = new Map<string, Set<() => void>>();

function readAttestedCredentials({ url, body }: {
  url: string;
  body: Uint8Array;
}) {
  const request = VideoPlaybackAbrRequest.decode(body);
  const poToken = request.streamerContext?.poToken;
  const ustreamerConfig = request.videoPlaybackUstreamerConfig;
  const isAttested = (poToken?.byteLength ?? 0) >= MIN_ATTESTED_PO_TOKEN_BYTES;
  if (!isAttested || !ustreamerConfig?.byteLength) {
    return null;
  }

  const streamingUrl = new URL(url);
  streamingUrl.searchParams.delete(REQUEST_NUMBER_PARAM);
  return {
    serverAbrStreamingUrl: streamingUrl.href,
    videoPlaybackUstreamerConfig: uint8ToBase64(ustreamerConfig),
    poToken: uint8ToBase64(required(poToken))
  };
}

type RecordPlayerSessionParams = Prettify<{
  tabId: number;
  url: string;
  body: Uint8Array;
}>;
export async function recordPlayerSession({ tabId, url, body }: RecordPlayerSessionParams) {
  const credentials = readAttestedCredentials({
    url,
    body
  });
  if (!credentials) {
    return;
  }

  const tab = await browser.tabs.get(tabId).catch(() => null);
  const videoId = tab?.url ? getVideoIdFromUrl(tab.url) : null;
  if (!videoId) {
    return;
  }

  sessionsByTab.set(tabId, {
    videoId,
    ...credentials
  });
}

export function recordFrameVideo({ frameId, url }: {
  frameId: number;
  url: string;
}) {
  const videoId = getVideoIdFromUrl(url);
  if (!videoId) {
    return;
  }

  // A new frame means the last session failed or ran out; its attempt must wait for a fresh one
  videoIdsByFrame.set(frameId, videoId);
  sessionsByVideo.delete(videoId);
}

type RecordFrameSessionParams = Prettify<{
  frameId: number;
  url: string;
  body: Uint8Array;
}>;
export function recordFrameSession({ frameId, url, body }: RecordFrameSessionParams) {
  const videoId = videoIdsByFrame.get(frameId);
  const credentials = videoId ? readAttestedCredentials({
    url,
    body
  }) : null;
  if (!videoId || !credentials) {
    return;
  }

  sessionsByVideo.set(videoId, {
    videoId,
    ...credentials
  });
  for (const resolve of sessionWaiters.get(videoId) ?? []) {
    resolve();
  }

  sessionWaiters.delete(videoId);
}

/** Resolves once a hidden frame's player has an attested session for the video, or on timeout */
export async function awaitFrameSession(videoId: string) {
  if (sessionsByVideo.has(videoId)) {
    return;
  }

  await new Promise<void>(resolve => {
    const waiters = sessionWaiters.get(videoId) ?? new Set();
    waiters.add(resolve);
    sessionWaiters.set(videoId, waiters);
    AbortSignal.timeout(FRAME_SESSION_TIMEOUT_MS).addEventListener("abort", () => {
      waiters.delete(resolve);
      resolve();
    }, { once: true });
  });
}

type GetPlayerSessionParams = Prettify<{
  tabId: number;
  videoId: string;
}>;
// Any tab playing the video can lend its session - the mobile site has no content script of its own
function getPlayerSession({ tabId, videoId }: GetPlayerSessionParams) {
  const ownSession = sessionsByTab.get(tabId);
  if (ownSession?.videoId === videoId) {
    return ownSession;
  }

  return sessionsByTab.values().find(session => session.videoId === videoId)
    ?? sessionsByVideo.get(videoId)
    ?? null;
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

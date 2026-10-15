import type { MoviePlayerElement } from "@/lib/youtube/movie-player-types";
import { playerResponseSchema } from "@/lib/youtube/schemas";
import { buildVideoData } from "@/lib/youtube/youtube-api";
import { YtcfgKey } from "@/lib/youtube/ytcfg";
import type { Prettify } from "@/types";
import { browser } from "#imports";

const MOVIE_PLAYER_SELECTOR = "#movie_player";
const MAIN_WORLD = "MAIN";

declare const ytcfg: {
  get: (key: string) => unknown;
} | undefined;

type PlayerSnapshotParams = Prettify<{
  videoId: string;
  moviePlayerSelector: string;
  clientVersionKey: string;
  clientNameKey: string;
}>;

// Runs inside the tab's main world, so it can only use what it's handed
function readPlayerSnapshot({ videoId, moviePlayerSelector, clientVersionKey, clientNameKey }: PlayerSnapshotParams) {
  const elPlayer = document.querySelector<MoviePlayerElement>(moviePlayerSelector);
  const playerResponse = [elPlayer?.getPlayerResponse?.(), window.ytInitialPlayerResponse]
    .find(response => response?.videoDetails?.videoId === videoId);
  if (!playerResponse) {
    return null;
  }

  const config = typeof ytcfg === "undefined" ? undefined : ytcfg;
  return {
    playerResponseJson: JSON.stringify(playerResponse),
    clientVersion: String(config?.get(clientVersionKey) ?? ""),
    clientName: Number(config?.get(clientNameKey) ?? 0)
  };
}

type ReadTabVideoDataParams = Prettify<{
  tabId: number;
  videoId: string;
}>;
export async function readTabVideoData({ tabId, videoId }: ReadTabVideoDataParams) {
  const [injection] = await browser.scripting.executeScript({
    target: {
      tabId
    },
    world: MAIN_WORLD,
    func: readPlayerSnapshot,
    args: [{
      videoId,
      moviePlayerSelector: MOVIE_PLAYER_SELECTOR,
      clientVersionKey: YtcfgKey.ClientVersion,
      clientNameKey: YtcfgKey.ClientName
    }]
  });
  const snapshot = injection?.result;
  if (!snapshot) {
    return null;
  }

  const parsed = playerResponseSchema.safeParse(JSON.parse(snapshot.playerResponseJson));
  if (!parsed.success) {
    return null;
  }

  return buildVideoData({
    playerResponse: parsed.data,
    clientVersion: snapshot.clientVersion,
    clientName: snapshot.clientName
  });
}

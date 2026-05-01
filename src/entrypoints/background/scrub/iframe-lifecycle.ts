import { removeHostedIframe, spawnHostedIframe } from "../iframe-host/iframe-host";
import {
  deadlineTimersByIframeId,
  globalInFlightIframeIds,
  iframeIdByVideoIdAndIndex,
  makeIframeId,
  makeIframeKey,
  recordEmptyAfterRetries
} from "./session-store";
import type { ScrubSession } from "./session-store";

const MAX_RETRIES_PER_INDEX = 4;
const IFRAME_DEADLINE_OVERHEAD_MS = 120_000;

function buildScrubIframeUrl({ videoId, iScrub, startSec, windowSec }: {
  videoId: string;
  iScrub: number;
  startSec: number;
  windowSec: number;
}) {
  const params = new URLSearchParams({
    v: videoId,
    ytdl: "1",
    ytdlScrubMode: "1",
    ytdlScrubIndex: String(iScrub),
    ytdlScrubWindow: String(windowSec),
    t: String(startSec)
  });

  return `https://www.youtube.com/watch?${params.toString()}`;
}

function trackIframeForSession({ session, iframeId, iScrub }: {
  session: ScrubSession;
  iframeId: string;
  iScrub: number;
}) {
  session.inFlightIframeIds.add(iframeId);
  globalInFlightIframeIds.add(iframeId);
  iframeIdByVideoIdAndIndex.set(makeIframeKey(session.videoId, iScrub), iframeId);
}

export function untrackIframe({ session, iframeId, iScrub }: {
  session: ScrubSession;
  iframeId: string;
  iScrub?: number;
}) {
  session.inFlightIframeIds.delete(iframeId);
  globalInFlightIframeIds.delete(iframeId);

  if (iScrub !== undefined) {
    iframeIdByVideoIdAndIndex.delete(makeIframeKey(session.videoId, iScrub));
  }

  const timer = deadlineTimersByIframeId.get(iframeId);
  if (timer !== undefined) {
    clearTimeout(timer);
    deadlineTimersByIframeId.delete(iframeId);
  }

  void removeHostedIframe(iframeId);
}

function requeueOrAccept({ session, iScrub, logFn }: {
  session: ScrubSession;
  iScrub: number;
  logFn: (msg: string) => void;
}) {
  const attempts = session.attemptsByIndex.get(iScrub) ?? 0;
  if (attempts < MAX_RETRIES_PER_INDEX) {
    session.attemptsByIndex.set(iScrub, attempts + 1);
    session.pendingIndices.push(iScrub);
    return;
  }

  recordEmptyAfterRetries({
    session,
    iScrub,
    logFn
  });
}

function armIframeDeadline({ session, iframeId, iScrub, windowSec, logFn, onExpired }: {
  session: ScrubSession;
  iframeId: string;
  iScrub: number;
  windowSec: number;
  logFn: (msg: string) => void;
  onExpired: () => void;
}) {
  const deadlineMs = windowSec * 1000 + IFRAME_DEADLINE_OVERHEAD_MS;
  const timer = setTimeout(() => {
    deadlineTimersByIframeId.delete(iframeId);

    if (!session.inFlightIframeIds.has(iframeId)) {
      return;
    }

    logFn(`iframe ${iframeId} (index ${iScrub}) hung past ${deadlineMs}ms, force-closing and retrying`);
    requeueOrAccept({
      session,
      iScrub,
      logFn
    });
    untrackIframe({
      session,
      iframeId,
      iScrub
    });
    onExpired();
  }, deadlineMs);
  deadlineTimersByIframeId.set(iframeId, timer);
}

export async function openScrubIframe({ session, iScrub, startSec, windowSec, logFn, onExpired }: {
  session: ScrubSession;
  iScrub: number;
  startSec: number;
  windowSec: number;
  logFn: (msg: string) => void;
  onExpired: () => void;
}) {
  const attempt = session.attemptsByIndex.get(iScrub) ?? 0;
  const iframeId = makeIframeId(session.videoId, iScrub, attempt);
  const url = buildScrubIframeUrl({
    videoId: session.videoId,
    iScrub,
    startSec,
    windowSec
  });

  await spawnHostedIframe({
    id: iframeId,
    url
  });
  logFn(`opened scrub iframe id=${iframeId} index=${iScrub} t=${startSec} window=${windowSec}s`);

  trackIframeForSession({
    session,
    iframeId,
    iScrub
  });
  armIframeDeadline({
    session,
    iframeId,
    iScrub,
    windowSec,
    logFn,
    onExpired
  });
}

import { removeHostedIframe, spawnHostedIframe } from "../iframe-host/iframe-host";
import {
  deadlineTimersByIframeId,
  globalInFlightIframeIds,
  iframeIdByVideoIdAndIndex,
  makeIframeId,
  makeIframeKey,
  recordEmptyAfterRetries
} from "./scrub-session-store";
import type { ScrubSession } from "./scrub-session-store";

const MAX_RETRIES_PER_INDEX = 2;
const IFRAME_DEADLINE_OVERHEAD_MS = 120_000;

export function buildScrubIframeUrl({ videoId, scrubIndex, startSec, windowSec }: {
  videoId: string;
  scrubIndex: number;
  startSec: number;
  windowSec: number;
}) {
  const params = new URLSearchParams({
    v: videoId,
    ytdl: "1",
    ytdlScrubMode: "1",
    ytdlScrubIndex: String(scrubIndex),
    ytdlScrubWindow: String(windowSec)
  });
  if (startSec > 0) {
    params.set("t", String(startSec));
  }

  return `https://www.youtube.com/watch?${params.toString()}`;
}

export function trackIframeForSession({ session, iframeId, scrubIndex }: {
  session: ScrubSession;
  iframeId: string;
  scrubIndex: number;
}) {
  session.inFlightIframeIds.add(iframeId);
  globalInFlightIframeIds.add(iframeId);
  iframeIdByVideoIdAndIndex.set(makeIframeKey(session.videoId, scrubIndex), iframeId);
}

export function untrackIframe({ session, iframeId, scrubIndex }: {
  session: ScrubSession;
  iframeId: string;
  scrubIndex?: number;
}) {
  session.inFlightIframeIds.delete(iframeId);
  globalInFlightIframeIds.delete(iframeId);

  if (scrubIndex !== undefined) {
    iframeIdByVideoIdAndIndex.delete(makeIframeKey(session.videoId, scrubIndex));
  }

  const timer = deadlineTimersByIframeId.get(iframeId);
  if (timer !== undefined) {
    clearTimeout(timer);
    deadlineTimersByIframeId.delete(iframeId);
  }

  void removeHostedIframe(iframeId);
}

export function requeueOrAccept({ session, scrubIndex, logFn }: {
  session: ScrubSession;
  scrubIndex: number;
  logFn: (msg: string) => void;
}) {
  const attempts = session.attemptsByIndex.get(scrubIndex) ?? 0;
  if (attempts < MAX_RETRIES_PER_INDEX) {
    session.attemptsByIndex.set(scrubIndex, attempts + 1);
    session.pendingIndices.push(scrubIndex);
    return;
  }

  recordEmptyAfterRetries({
    session,
    scrubIndex,
    logFn
  });
}

function armIframeDeadline({ session, iframeId, scrubIndex, windowSec, logFn, onExpired }: {
  session: ScrubSession;
  iframeId: string;
  scrubIndex: number;
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

    logFn(`iframe ${iframeId} (index ${scrubIndex}) hung past ${deadlineMs}ms, force-closing and retrying`);
    requeueOrAccept({
      session,
      scrubIndex,
      logFn
    });
    untrackIframe({
      session,
      iframeId,
      scrubIndex
    });
    onExpired();
  }, deadlineMs);
  deadlineTimersByIframeId.set(iframeId, timer);
}

export async function openScrubIframe({ session, scrubIndex, startSec, windowSec, logFn, onExpired }: {
  session: ScrubSession;
  scrubIndex: number;
  startSec: number;
  windowSec: number;
  logFn: (msg: string) => void;
  onExpired: () => void;
}) {
  const attempt = session.attemptsByIndex.get(scrubIndex) ?? 0;
  const iframeId = makeIframeId(session.videoId, scrubIndex, attempt);
  const url = buildScrubIframeUrl({
    videoId: session.videoId,
    scrubIndex,
    startSec,
    windowSec
  });

  await spawnHostedIframe({
    id: iframeId,
    url
  });
  logFn(`opened scrub iframe id=${iframeId} index=${scrubIndex} t=${startSec} window=${windowSec}s`);

  trackIframeForSession({
    session,
    iframeId,
    scrubIndex
  });
  armIframeDeadline({
    session,
    iframeId,
    scrubIndex,
    windowSec,
    logFn,
    onExpired
  });
}

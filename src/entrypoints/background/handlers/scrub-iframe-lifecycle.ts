import { spawnHostedIframe } from "../iframe-host/iframe-host";
import { buildScrubIframeUrl, requeueOrAccept, trackIframeForSession, untrackIframe } from "./scrub-iframe-tracker";
import { deadlineTimersByIframeId, makeIframeId } from "./scrub-session-store";
import type { ScrubSession } from "./scrub-session-types";

export { untrackIframe } from "./scrub-iframe-tracker";

const IFRAME_DEADLINE_OVERHEAD_MS = 120_000;

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

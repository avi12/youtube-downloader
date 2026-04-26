import { removeHostedIframe, setIframeScrubSegmentHandler, spawnHostedIframe } from "../iframe-host/iframe-host";
import { ensureProcessor } from "./processor";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { TRANSFER_CHUNK_SIZE, base64ToUint8Array, uint8ToBase64 } from "@/lib/utils/binary";
import { type DownloadType, ProgressType, type VideoMetadata } from "@/types";

function bgLog(msg: string) {
  console.log(msg);
  void browser.tabs.query({ url: "*://www.youtube.com/*" }).then(tabs => {
    for (const tab of tabs) {
      if (typeof tab.id === "number") {
        void sendMessage(MessageType.BgDebugLog, { msg }, tab.id);
      }
    }
  });
}

// Each scrub iframe loads a full YouTube watch page (~250 MB RAM) and holds a
// SABR session against the user's IP, so cap globally rather than per-session
// to prevent browser OOM and YouTube per-IP rate-limiting when batch-downloading.
const MAX_GLOBAL_PARALLEL_IFRAMES = 2;
const MAX_RETRIES_PER_INDEX = 2;
const MIN_ACCEPTABLE_BYTES_PER_SEC = 30_000;
// Hard ceiling for a scrub iframe: page load + player ready (~15 s) + ad-clear
// (~10 s) + buffer-fill (windowSec) + reporting slack. If the iframe hasn't
// reported by then it's stuck (autoplay block, content-script crash, etc.) so
// force-remove and retry.
const IFRAME_DEADLINE_OVERHEAD_MS = 60_000;
// 60s matches the server's natural buffer-ahead window: a paused player at
// &t=N gets ~60s of media in the initial SABR response before it stops sending.
const DEFAULT_STEP_SEC = 60;

interface ReceivedSegment {
  videoBase64: string;
  audioBase64: string;
  videoMimeType: string;
  audioMimeType: string;
}

interface ScrubSession {
  videoId: string;
  expectedCount: number;
  stepSec: number;
  receivedSegments: Map<number, ReceivedSegment>;
  pendingIndices: number[];
  attemptsByIndex: Map<number, number>;
  inFlightIframeIds: Set<string>;
  tabId: number;
  filenameOutput: string;
  type: DownloadType;
  videoMimeType: string;
  audioMimeType: string;
  audioLabel: string;
  metadata?: VideoMetadata | null;
  playlistId?: string;
  playlistTitle?: string;
  playlistTotalCount?: number;
  resolvedVideoMimeType: string;
  resolvedAudioMimeType: string;
}

const sessionsByVideoId = new Map<string, ScrubSession>();
const sessionByIframeId = new Map<string, string>();
const iframeDeadlineTimers = new Map<string, ReturnType<typeof setTimeout>>();
const iframeIndexById = new Map<string, number>();
const globalInFlightIframeIds = new Set<string>();
let roundRobinCursor = 0;

function makeIframeId(videoId: string, scrubIndex: number, attempt: number) {
  return `${videoId}:${scrubIndex}:${attempt}`;
}

function pickNextWorkRoundRobin() {
  const sessions = Array.from(sessionsByVideoId.values());
  if (sessions.length === 0) {
    return null;
  }

  for (let offset = 0; offset < sessions.length; offset++) {
    const idx = (roundRobinCursor + offset) % sessions.length;
    const session = sessions[idx];
    if (session.pendingIndices.length > 0) {
      const scrubIndex = session.pendingIndices.shift();
      if (scrubIndex !== undefined) {
        roundRobinCursor = (idx + 1) % sessions.length;
        return {
          session,
          scrubIndex
        };
      }
    }
  }

  return null;
}

async function fillGlobalSlots() {
  while (globalInFlightIframeIds.size < MAX_GLOBAL_PARALLEL_IFRAMES) {
    const work = pickNextWorkRoundRobin();
    if (!work) {
      return;
    }

    await openScrubIframe({
      session: work.session,
      scrubIndex: work.scrubIndex,
      startSec: work.scrubIndex * work.session.stepSec,
      windowSec: work.session.stepSec
    });
  }
}

function reportFetchProgress(session: ScrubSession) {
  if (session.expectedCount === 0) {
    return;
  }

  const fraction = Math.min(session.receivedSegments.size / session.expectedCount, 1);
  void sendMessage(
    MessageType.UpdateDownloadProgress,
    {
      videoId: session.videoId,
      progress: fraction,
      progressType: ProgressType.Video
    },
    session.tabId
  );
}

async function openScrubIframe({ session, scrubIndex, startSec, windowSec }: {
  session: ScrubSession;
  scrubIndex: number;
  startSec: number;
  windowSec: number;
}) {
  const attempt = session.attemptsByIndex.get(scrubIndex) ?? 0;
  const iframeId = makeIframeId(session.videoId, scrubIndex, attempt);
  const params = new URLSearchParams({
    v: session.videoId,
    ytdl: "1",
    ytdlScrubMode: "1",
    ytdlScrubIndex: String(scrubIndex),
    ytdlScrubWindow: String(windowSec)
  });
  if (startSec > 0) {
    params.set("t", String(startSec));
  }

  const url = `https://www.youtube.com/watch?${params.toString()}`;
  await spawnHostedIframe({
    id: iframeId,
    url
  });
  bgLog(`[ytdl:scrub-bg] opened scrub iframe id=${iframeId} index=${scrubIndex} t=${startSec} window=${windowSec}s`);

  session.inFlightIframeIds.add(iframeId);
  globalInFlightIframeIds.add(iframeId);
  sessionByIframeId.set(iframeId, session.videoId);
  iframeIndexById.set(iframeId, scrubIndex);
  armIframeDeadline({
    session,
    iframeId,
    scrubIndex,
    windowSec
  });
}

function armIframeDeadline({ session, iframeId, scrubIndex, windowSec }: {
  session: ScrubSession;
  iframeId: string;
  scrubIndex: number;
  windowSec: number;
}) {
  const deadlineMs = windowSec * 1000 + IFRAME_DEADLINE_OVERHEAD_MS;
  const timer = setTimeout(() => {
    iframeDeadlineTimers.delete(iframeId);

    if (!session.inFlightIframeIds.has(iframeId)) {
      return;
    }

    bgLog(`[ytdl:scrub-bg] iframe ${iframeId} (index ${scrubIndex}) hung past ${deadlineMs}ms, force-closing and retrying`);
    const attempts = session.attemptsByIndex.get(scrubIndex) ?? 0;
    if (attempts < MAX_RETRIES_PER_INDEX) {
      session.attemptsByIndex.set(scrubIndex, attempts + 1);
      session.pendingIndices.push(scrubIndex);
    } else {
      bgLog(`[ytdl:scrub-bg] index ${scrubIndex} exhausted retries, accepting empty`);
      session.receivedSegments.set(scrubIndex, {
        videoBase64: "",
        audioBase64: "",
        videoMimeType: "",
        audioMimeType: ""
      });
      reportFetchProgress(session);
    }

    closeScrubIframe({
      session,
      iframeId
    });

    if (session.receivedSegments.size >= session.expectedCount) {
      void finalizeSession(session);
      return;
    }

    void fillGlobalSlots();
  }, deadlineMs);
  iframeDeadlineTimers.set(iframeId, timer);
}

function clearIframeDeadline(iframeId: string) {
  const timer = iframeDeadlineTimers.get(iframeId);
  if (timer !== undefined) {
    clearTimeout(timer);
    iframeDeadlineTimers.delete(iframeId);
  }
}

function closeScrubIframe({ session, iframeId }: {
  session: ScrubSession;
  iframeId: string;
}) {
  session.inFlightIframeIds.delete(iframeId);
  globalInFlightIframeIds.delete(iframeId);
  sessionByIframeId.delete(iframeId);
  iframeIndexById.delete(iframeId);
  clearIframeDeadline(iframeId);
  removeHostedIframe(iframeId);
}

function cleanupSession(session: ScrubSession) {
  for (const iframeId of session.inFlightIframeIds) {
    globalInFlightIframeIds.delete(iframeId);
    sessionByIframeId.delete(iframeId);
    iframeIndexById.delete(iframeId);
    clearIframeDeadline(iframeId);
    removeHostedIframe(iframeId);
  }
  session.inFlightIframeIds.clear();
  sessionsByVideoId.delete(session.videoId);
}

function emitSegmentChunks({ session, scrubIndex, base64, mediaKind }: {
  session: ScrubSession;
  scrubIndex: number;
  base64: string;
  mediaKind: "video" | "audio";
}) {
  const bytes = base64ToUint8Array(base64);
  const totalChunks = Math.max(1, Math.ceil(bytes.byteLength / TRANSFER_CHUNK_SIZE));
  const streamType = `${mediaKind}-seg-${scrubIndex}`;

  for (let iChunk = 0; iChunk < totalChunks; iChunk++) {
    const start = iChunk * TRANSFER_CHUNK_SIZE;
    const slice = bytes.subarray(start, start + TRANSFER_CHUNK_SIZE);
    sendToOffscreen(OffscreenMessageType.ProcessStreamChunk, {
      videoId: session.videoId,
      streamType,
      iChunk,
      totalChunks,
      chunkBase64: uint8ToBase64(slice),
      tabId: session.tabId
    });
  }
}

async function finalizeSession(session: ScrubSession) {
  await ensureProcessor();

  for (const [scrubIndex, segment] of session.receivedSegments) {
    if (!session.resolvedVideoMimeType && segment.videoMimeType) {
      session.resolvedVideoMimeType = segment.videoMimeType;
    }

    if (!session.resolvedAudioMimeType && segment.audioMimeType) {
      session.resolvedAudioMimeType = segment.audioMimeType;
    }

    emitSegmentChunks({
      session,
      scrubIndex,
      base64: segment.videoBase64,
      mediaKind: "video"
    });
    emitSegmentChunks({
      session,
      scrubIndex,
      base64: segment.audioBase64,
      mediaKind: "audio"
    });
  }

  sendToOffscreen(OffscreenMessageType.ProcessStreamEnd, {
    type: session.type,
    videoId: session.videoId,
    filenameOutput: session.filenameOutput,
    videoMimeType: session.resolvedVideoMimeType || session.videoMimeType,
    audioMimeType: session.resolvedAudioMimeType || session.audioMimeType,
    audioTrackLabels: [session.audioLabel],
    segmentCount: session.expectedCount,
    tabId: session.tabId,
    playlistId: session.playlistId,
    playlistTitle: session.playlistTitle,
    playlistTotalCount: session.playlistTotalCount,
    metadata: session.metadata
  });

  cleanupSession(session);
}

function findIframeIdForSegment({ videoId, scrubIndex }: {
  videoId: string;
  scrubIndex: number;
}): string | null {
  for (const [iframeId, sessionVideoId] of sessionByIframeId) {
    if (sessionVideoId !== videoId) {
      continue;
    }

    if (iframeIndexById.get(iframeId) === scrubIndex) {
      return iframeId;
    }
  }

  return null;
}

export interface StartIframeScrubArgs {
  videoId: string;
  durationSec: number;
  stepSec?: number;
  type: DownloadType;
  filenameOutput: string;
  videoMimeType: string;
  audioMimeType: string;
  audioLabel: string;
  metadata?: VideoMetadata | null;
  playlistId?: string;
  playlistTitle?: string;
  playlistTotalCount?: number;
  tabId: number;
}

export async function startIframeScrubSession(data: StartIframeScrubArgs) {
  const stepSec = data.stepSec || DEFAULT_STEP_SEC;
  const expectedCount = Math.max(1, Math.ceil(data.durationSec / stepSec));

  const session: ScrubSession = {
    videoId: data.videoId,
    expectedCount,
    stepSec,
    receivedSegments: new Map(),
    pendingIndices: Array.from({ length: expectedCount }, (_, index) => index),
    attemptsByIndex: new Map(),
    inFlightIframeIds: new Set(),
    tabId: data.tabId,
    filenameOutput: data.filenameOutput,
    type: data.type,
    videoMimeType: data.videoMimeType,
    audioMimeType: data.audioMimeType,
    audioLabel: data.audioLabel,
    metadata: data.metadata,
    playlistId: data.playlistId,
    playlistTitle: data.playlistTitle,
    playlistTotalCount: data.playlistTotalCount,
    resolvedVideoMimeType: "",
    resolvedAudioMimeType: ""
  };
  sessionsByVideoId.set(data.videoId, session);

  bgLog(`[ytdl:scrub-bg] starting ${expectedCount} scrub iframes for ${data.videoId}`);
  await fillGlobalSlots();
}

export function registerIframeScrubOrchestrator() {
  // Direct postMessage handler for BG-hosted iframes on Firefox: content
  // scripts don't inject into iframes whose top-level document is
  // moz-extension://, so the runtime.sendMessage relay never fires. The
  // MAIN-world driver postMessages the segment buffer to the host
  // document, which forwards it through this hook.
  setIframeScrubSegmentHandler(segment => {
    void handleSegmentArrival({
      videoId: segment.videoId,
      scrubIndex: segment.scrubIndex,
      videoBase64: uint8ToBase64(segment.videoBytes),
      audioBase64: uint8ToBase64(segment.audioBytes),
      videoMimeType: segment.videoMimeType,
      audioMimeType: segment.audioMimeType
    });
  });

  onMessage(MessageType.StartIframeScrub, async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") {
      return;
    }

    await startIframeScrubSession({
      ...data,
      tabId
    });
  });

  onMessage(MessageType.IframeScrubSegmentReady, async ({ data }) => {
    await handleSegmentArrival({
      videoId: data.videoId,
      scrubIndex: data.scrubIndex,
      videoBase64: data.videoBase64,
      audioBase64: data.audioBase64,
      videoMimeType: data.videoMimeType,
      audioMimeType: data.audioMimeType
    });
  });
}

interface SegmentArrival {
  videoId: string;
  scrubIndex: number;
  videoBase64: string;
  audioBase64: string;
  videoMimeType: string;
  audioMimeType: string;
}

async function handleSegmentArrival(data: SegmentArrival) {
  const session = sessionsByVideoId.get(data.videoId);
  if (!session) {
    return;
  }

  const iframeId = findIframeIdForSegment({
    videoId: data.videoId,
    scrubIndex: data.scrubIndex
  });
  if (iframeId) {
    closeScrubIframe({
      session,
      iframeId
    });
  }

  const totalBytes = base64ToUint8Array(data.videoBase64).byteLength
    + base64ToUint8Array(data.audioBase64).byteLength;
  const attempts = session.attemptsByIndex.get(data.scrubIndex) ?? 0;
  const minAcceptableBytes = MIN_ACCEPTABLE_BYTES_PER_SEC * session.stepSec;
  if (totalBytes < minAcceptableBytes && attempts < MAX_RETRIES_PER_INDEX) {
    session.attemptsByIndex.set(data.scrubIndex, attempts + 1);
    session.pendingIndices.push(data.scrubIndex);
    bgLog(`[ytdl:scrub-bg] segment ${data.scrubIndex} undersized (${totalBytes}B < ${minAcceptableBytes}B), retrying (attempt ${attempts + 2}/${MAX_RETRIES_PER_INDEX + 1})`);
    await fillGlobalSlots();
    return;
  }

  session.receivedSegments.set(data.scrubIndex, {
    videoBase64: data.videoBase64,
    audioBase64: data.audioBase64,
    videoMimeType: data.videoMimeType,
    audioMimeType: data.audioMimeType
  });
  reportFetchProgress(session);

  bgLog(`[ytdl:scrub-bg] received segment ${data.scrubIndex + 1}/${session.expectedCount} for ${data.videoId} (${totalBytes}B)`);

  if (session.receivedSegments.size >= session.expectedCount) {
    await finalizeSession(session);
    await fillGlobalSlots();
    return;
  }

  await fillGlobalSlots();
}


export function cancelIframeScrubSession(videoId: string) {
  const session = sessionsByVideoId.get(videoId);
  if (session) {
    cleanupSession(session);
  }
}

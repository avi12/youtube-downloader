import { removeHostedIframe, setIframeScrubSegmentHandler, spawnHostedIframe } from "../iframe-host/iframe-host";
import { ensureProcessor } from "./processor";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { ScrubIframeMessageType, listenForScrubIframeMessages } from "@/lib/messaging/scrub-iframe-messaging";
import { TRANSFER_CHUNK_SIZE, base64ToUint8Array, uint8ToBase64 } from "@/lib/utils/binary";
import { type DownloadType, ProgressType, type VideoMetadata } from "@/types";

const MAX_GLOBAL_PARALLEL_IFRAMES = 2;
const MAX_RETRIES_PER_INDEX = 2;
const MIN_ACCEPTABLE_BYTES_PER_SEC = 30_000;
const IFRAME_DEADLINE_OVERHEAD_MS = 60_000;
const DEFAULT_STEP_SEC = 60;
const SCRUB_TAG = "[ytdl:scrub-bg]";

interface ReceivedSegment {
  videoBase64: string;
  audioBase64: string;
  videoMimeType: string;
  audioMimeType: string;
}

interface SegmentArrival extends ReceivedSegment {
  videoId: string;
  scrubIndex: number;
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
const iframeIdByVideoIdAndIndex = new Map<string, string>();
const deadlineTimersByIframeId = new Map<string, ReturnType<typeof setTimeout>>();
const globalInFlightIframeIds = new Set<string>();
let roundRobinCursor = 0;

function makeIframeKey(videoId: string, scrubIndex: number) {
  return `${videoId}:${scrubIndex}`;
}

async function broadcastDiag(msg: string) {
  console.log(msg);
  const tabs = await browser.tabs.query({ url: "*://www.youtube.com/*" });
  for (const tab of tabs) {
    if (typeof tab.id !== "number") {
      continue;
    }

    void sendMessage(MessageType.BgDebugLog, { msg }, tab.id);
  }
}

function diag(msg: string) {
  void broadcastDiag(`${SCRUB_TAG} ${msg}`);
}

function makeIframeId(videoId: string, scrubIndex: number, attempt: number) {
  return `${videoId}:${scrubIndex}:${attempt}`;
}

function buildScrubIframeUrl({ videoId, scrubIndex, startSec, windowSec }: {
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

function pickNextWorkRoundRobin() {
  const sessions = Array.from(sessionsByVideoId.values());
  for (let offset = 0; offset < sessions.length; offset++) {
    const idx = (roundRobinCursor + offset) % sessions.length;
    const session = sessions[idx];
    const scrubIndex = session.pendingIndices.shift();
    if (scrubIndex === undefined) {
      continue;
    }

    roundRobinCursor = (idx + 1) % sessions.length;
    return {
      session,
      scrubIndex
    };
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

function trackIframeForSession({ session, iframeId, scrubIndex }: {
  session: ScrubSession;
  iframeId: string;
  scrubIndex: number;
}) {
  session.inFlightIframeIds.add(iframeId);
  globalInFlightIframeIds.add(iframeId);
  iframeIdByVideoIdAndIndex.set(makeIframeKey(session.videoId, scrubIndex), iframeId);
}

function untrackIframe({ session, iframeId, scrubIndex }: {
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

  removeHostedIframe(iframeId);
}

async function openScrubIframe({ session, scrubIndex, startSec, windowSec }: {
  session: ScrubSession;
  scrubIndex: number;
  startSec: number;
  windowSec: number;
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
  diag(`opened scrub iframe id=${iframeId} index=${scrubIndex} t=${startSec} window=${windowSec}s`);

  trackIframeForSession({
    session,
    iframeId,
    scrubIndex
  });
  armIframeDeadline({
    session,
    iframeId,
    scrubIndex,
    windowSec
  });
}

function recordEmptyAfterRetries({ session, scrubIndex }: {
  session: ScrubSession;
  scrubIndex: number;
}) {
  diag(`index ${scrubIndex} exhausted retries, accepting empty`);
  session.receivedSegments.set(scrubIndex, {
    videoBase64: "",
    audioBase64: "",
    videoMimeType: "",
    audioMimeType: ""
  });
  reportFetchProgress(session);
}

function requeueOrAccept({ session, scrubIndex }: {
  session: ScrubSession;
  scrubIndex: number;
}) {
  const attempts = session.attemptsByIndex.get(scrubIndex) ?? 0;
  if (attempts < MAX_RETRIES_PER_INDEX) {
    session.attemptsByIndex.set(scrubIndex, attempts + 1);
    session.pendingIndices.push(scrubIndex);
    return;
  }

  recordEmptyAfterRetries({
    session,
    scrubIndex
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
    deadlineTimersByIframeId.delete(iframeId);

    if (!session.inFlightIframeIds.has(iframeId)) {
      return;
    }

    diag(`iframe ${iframeId} (index ${scrubIndex}) hung past ${deadlineMs}ms, force-closing and retrying`);
    requeueOrAccept({
      session,
      scrubIndex
    });
    untrackIframe({
      session,
      iframeId,
      scrubIndex
    });

    if (session.receivedSegments.size >= session.expectedCount) {
      void finalizeSession(session);
      return;
    }

    void fillGlobalSlots();
  }, deadlineMs);
  deadlineTimersByIframeId.set(iframeId, timer);
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

function rememberResolvedMimes({ session, segment }: {
  session: ScrubSession;
  segment: ReceivedSegment;
}) {
  if (!session.resolvedVideoMimeType && segment.videoMimeType) {
    session.resolvedVideoMimeType = segment.videoMimeType;
  }

  if (!session.resolvedAudioMimeType && segment.audioMimeType) {
    session.resolvedAudioMimeType = segment.audioMimeType;
  }
}

async function finalizeSession(session: ScrubSession) {
  await ensureProcessor();

  for (const [scrubIndex, segment] of session.receivedSegments) {
    rememberResolvedMimes({
      session,
      segment
    });
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

  releaseSession(session);
}

function releaseSession(session: ScrubSession) {
  for (const iframeId of Array.from(session.inFlightIframeIds)) {
    untrackIframe({
      session,
      iframeId
    });
  }

  sessionsByVideoId.delete(session.videoId);
}

function isSegmentTooSmall({ session, totalBytes }: {
  session: ScrubSession;
  totalBytes: number;
}) {
  return totalBytes < MIN_ACCEPTABLE_BYTES_PER_SEC * session.stepSec;
}

async function handleSegmentArrival(data: SegmentArrival) {
  const session = sessionsByVideoId.get(data.videoId);
  if (!session) {
    return;
  }

  const iframeId = iframeIdByVideoIdAndIndex.get(makeIframeKey(data.videoId, data.scrubIndex));
  if (iframeId) {
    untrackIframe({
      session,
      iframeId,
      scrubIndex: data.scrubIndex
    });
  }

  const totalBytes = base64ToUint8Array(data.videoBase64).byteLength
    + base64ToUint8Array(data.audioBase64).byteLength;
  const attempts = session.attemptsByIndex.get(data.scrubIndex) ?? 0;
  if (isSegmentTooSmall({
    session,
    totalBytes
  }) && attempts < MAX_RETRIES_PER_INDEX) {
    session.attemptsByIndex.set(data.scrubIndex, attempts + 1);
    session.pendingIndices.push(data.scrubIndex);
    diag(`segment ${data.scrubIndex} undersized (${totalBytes}B), retrying ${attempts + 2}/${MAX_RETRIES_PER_INDEX + 1}`);
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
  diag(`received segment ${data.scrubIndex + 1}/${session.expectedCount} for ${data.videoId} (${totalBytes}B)`);

  if (session.receivedSegments.size >= session.expectedCount) {
    await finalizeSession(session);
    await fillGlobalSlots();
    return;
  }

  await fillGlobalSlots();
}

function buildSession(data: StartIframeScrubArgs, stepSec: number, expectedCount: number): ScrubSession {
  return {
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
  const session = buildSession(data, stepSec, expectedCount);

  sessionsByVideoId.set(data.videoId, session);
  diag(`starting ${expectedCount} scrub iframes for ${data.videoId}`);
  await fillGlobalSlots();
}

export function cancelIframeScrubSession(videoId: string) {
  const session = sessionsByVideoId.get(videoId);
  if (session) {
    releaseSession(session);
  }
}

function registerScrubIframePort() {
  listenForScrubIframeMessages({
    [ScrubIframeMessageType.Hello](data) {
      diag(`iframe port hello videoId=${data.videoId} index=${data.scrubIndex}`);
    },
    [ScrubIframeMessageType.Debug](data) {
      void broadcastDiag(data.msg);
    },
    [ScrubIframeMessageType.Segment](data) {
      void handleSegmentArrival(data);
    }
  });
}

function registerPostMessageFallback() {
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
}

function registerStartHandler() {
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
}

function registerLegacySendMessageHandler() {
  onMessage(MessageType.IframeScrubSegmentReady, async ({ data }) => {
    await handleSegmentArrival(data);
  });
}

export function registerIframeScrubOrchestrator() {
  registerScrubIframePort();
  registerPostMessageFallback();
  registerStartHandler();
  registerLegacySendMessageHandler();
}

import { ensureProcessor } from "./processor";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { TRANSFER_CHUNK_SIZE, base64ToUint8Array, uint8ToBase64 } from "@/lib/utils/binary";
import type { DownloadType, VideoMetadata } from "@/types";

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

const MAX_PARALLEL_TABS = 2;
const MAX_RETRIES_PER_INDEX = 2;
const MIN_ACCEPTABLE_BYTES_PER_SEC = 30_000;
// Hard ceiling for a scrub tab: page load + player ready (~15 s) + ad-clear
// (~10 s) + buffer-fill (windowSec) + reporting slack. If the tab hasn't
// reported by then it's stuck (autoplay block, content-script crash, etc.)
// so force-close and retry.
const TAB_DEADLINE_OVERHEAD_MS = 60_000;
const SCRUB_WINDOW_WIDTH = 480;
const SCRUB_WINDOW_HEIGHT = 270;

interface ScrubSession {
  videoId: string;
  expectedCount: number;
  stepSec: number;
  receivedSegments: Map<number, {
    videoBase64: string;
    audioBase64: string;
    videoMimeType: string;
    audioMimeType: string;
  }>;
  pendingIndices: number[];
  attemptsByIndex: Map<number, number>;
  inFlightTabIds: Set<number>;
  windowId?: number;
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
const sessionByTabId = new Map<number, string>();
const tabDeadlineTimers = new Map<number, ReturnType<typeof setTimeout>>();
const tabIndexByTabId = new Map<number, number>();

async function openScrubTab({ session, scrubIndex, startSec, windowSec }: {
  session: ScrubSession;
  scrubIndex: number;
  startSec: number;
  windowSec: number;
}) {
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
  const tabOptions: Browser.tabs.CreateProperties = {
    url,
    active: false
  };
  if (typeof session.windowId === "number") {
    tabOptions.windowId = session.windowId;
  }

  const newTab = await browser.tabs.create(tabOptions);
  bgLog(`[ytdl:scrub-bg] opened scrub tab id=${newTab.id} index=${scrubIndex} t=${startSec} window=${windowSec}s`);

  if (typeof newTab.id === "number") {
    session.inFlightTabIds.add(newTab.id);
    sessionByTabId.set(newTab.id, session.videoId);
    tabIndexByTabId.set(newTab.id, scrubIndex);
    armTabDeadline({
      session,
      tabId: newTab.id,
      scrubIndex,
      windowSec
    });
  }

  return newTab.id;
}

function armTabDeadline({ session, tabId, scrubIndex, windowSec }: {
  session: ScrubSession;
  tabId: number;
  scrubIndex: number;
  windowSec: number;
}) {
  const deadlineMs = windowSec * 1000 + TAB_DEADLINE_OVERHEAD_MS;
  const timer = setTimeout(() => {
    tabDeadlineTimers.delete(tabId);

    if (!session.inFlightTabIds.has(tabId)) {
      return;
    }

    bgLog(`[ytdl:scrub-bg] tab ${tabId} (index ${scrubIndex}) hung past ${deadlineMs}ms, force-closing and retrying`);
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
    }

    void closeScrubTab({
      session,
      tabId
    }).then(() => {
      if (session.receivedSegments.size >= session.expectedCount) {
        void finalizeSession(session);
        return;
      }

      void fillTabSlots(session);
    });
  }, deadlineMs);
  tabDeadlineTimers.set(tabId, timer);
}

function clearTabDeadline(tabId: number) {
  const timer = tabDeadlineTimers.get(tabId);
  if (timer !== undefined) {
    clearTimeout(timer);
    tabDeadlineTimers.delete(tabId);
  }
}

async function fillTabSlots(session: ScrubSession) {
  while (session.inFlightTabIds.size < MAX_PARALLEL_TABS && session.pendingIndices.length > 0) {
    const scrubIndex = session.pendingIndices.shift();
    if (scrubIndex === undefined) {
      break;
    }

    await openScrubTab({
      session,
      scrubIndex,
      startSec: scrubIndex * session.stepSec,
      windowSec: session.stepSec
    });
  }
}

async function closeScrubTab({ session, tabId }: {
  session: ScrubSession;
  tabId: number;
}) {
  session.inFlightTabIds.delete(tabId);
  sessionByTabId.delete(tabId);
  tabIndexByTabId.delete(tabId);
  clearTabDeadline(tabId);
  try {
    await browser.tabs.remove(tabId);
  } catch (_) {
    // tab may already be closed
  }
}

async function cleanupSession(session: ScrubSession) {
  for (const tabId of session.inFlightTabIds) {
    sessionByTabId.delete(tabId);
    tabIndexByTabId.delete(tabId);
    clearTabDeadline(tabId);
    try {
      await browser.tabs.remove(tabId);
    } catch (_) {
      // best-effort
    }
  }
  session.inFlightTabIds.clear();

  if (typeof session.windowId === "number") {
    try {
      await browser.windows.remove(session.windowId);
    } catch (_) {
      // best-effort
    }
  }

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

  await cleanupSession(session);
}

export function registerIframeScrubOrchestrator() {
  onMessage(MessageType.StartIframeScrub, async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") {
      return;
    }

    const stepSec = data.stepSec || 30;
    const expectedCount = Math.max(1, Math.ceil(data.durationSec / stepSec));

    let windowId: number | undefined;
    try {
      const scrubWindow = await browser.windows.create({
        url: "about:blank",
        type: "popup",
        state: "minimized",
        focused: false,
        width: SCRUB_WINDOW_WIDTH,
        height: SCRUB_WINDOW_HEIGHT,
        left: -10000,
        top: -10000
      });
      windowId = scrubWindow?.id;
      const blankTabId = scrubWindow?.tabs?.[0]?.id;
      if (typeof blankTabId === "number") {
        try {
          await browser.tabs.remove(blankTabId);
        } catch (_) {
          // best-effort blank-tab cleanup
        }
      }
    } catch (error) {
      bgLog(`[ytdl:scrub-bg] windows.create failed, falling back to user's window: ${String(error)}`);
    }

    if (typeof windowId !== "number") {
      bgLog("[ytdl:scrub-bg] using sender's window for scrub tabs");
    }

    const session: ScrubSession = {
      videoId: data.videoId,
      expectedCount,
      stepSec,
      receivedSegments: new Map(),
      pendingIndices: Array.from({ length: expectedCount }, (_, i) => i),
      attemptsByIndex: new Map(),
      inFlightTabIds: new Set(),
      windowId,
      tabId,
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

    bgLog(`[ytdl:scrub-bg] starting ${expectedCount} scrub tabs for ${data.videoId} in window ${windowId}`);
    await fillTabSlots(session);
  });

  onMessage(MessageType.IframeScrubSegmentReady, async ({ data, sender }) => {
    const session = sessionsByVideoId.get(data.videoId);
    if (!session) {
      return;
    }

    if (typeof sender.tab?.id === "number") {
      await closeScrubTab({
        session,
        tabId: sender.tab.id
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
      await fillTabSlots(session);
      return;
    }

    session.receivedSegments.set(data.scrubIndex, {
      videoBase64: data.videoBase64,
      audioBase64: data.audioBase64,
      videoMimeType: data.videoMimeType,
      audioMimeType: data.audioMimeType
    });

    bgLog(`[ytdl:scrub-bg] received segment ${data.scrubIndex + 1}/${session.expectedCount} for ${data.videoId} (${totalBytes}B)`);

    if (session.receivedSegments.size >= session.expectedCount) {
      await finalizeSession(session);
      return;
    }

    await fillTabSlots(session);
  });

  browser.tabs.onRemoved.addListener(tabId => {
    const videoId = sessionByTabId.get(tabId);
    if (!videoId) {
      return;
    }

    const session = sessionsByVideoId.get(videoId);
    if (!session) {
      return;
    }

    if (session.inFlightTabIds.has(tabId)) {
      session.inFlightTabIds.delete(tabId);
      sessionByTabId.delete(tabId);
      void fillTabSlots(session);
    }
  });
}

export async function cancelIframeScrubSession(videoId: string) {
  const session = sessionsByVideoId.get(videoId);
  if (session) {
    await cleanupSession(session);
  }
}

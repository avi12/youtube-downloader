import { ensureProcessor } from "./processor";
import { MessageType, onMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { TRANSFER_CHUNK_SIZE, base64ToUint8Array, uint8ToBase64 } from "@/lib/utils/binary";
import type { DownloadType, VideoMetadata } from "@/types";

const MAX_PARALLEL_TABS = 2;
const MAX_RETRIES_PER_INDEX = 2;
const MIN_ACCEPTABLE_TOTAL_BYTES = 200_000;
const SCRUB_WINDOW_WIDTH = 480;
const SCRUB_WINDOW_HEIGHT = 270;

interface ScrubSession {
  videoId: string;
  expectedCount: number;
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

async function openScrubTab({ session, scrubIndex, startSec }: {
  session: ScrubSession;
  scrubIndex: number;
  startSec: number;
}) {
  const params = new URLSearchParams({
    v: session.videoId,
    ytdl: "1",
    ytdlScrubMode: "1",
    ytdlScrubIndex: String(scrubIndex)
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
  console.log(`[ytdl:scrub-bg] opened scrub tab id=${newTab.id} index=${scrubIndex} t=${startSec}`);

  if (typeof newTab.id === "number") {
    session.inFlightTabIds.add(newTab.id);
    sessionByTabId.set(newTab.id, session.videoId);
  }

  return newTab.id;
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
      startSec: scrubIndex * 30
    });
  }
}

async function closeScrubTab({ session, tabId }: {
  session: ScrubSession;
  tabId: number;
}) {
  session.inFlightTabIds.delete(tabId);
  sessionByTabId.delete(tabId);
  try {
    await browser.tabs.remove(tabId);
  } catch (_) {
    // tab may already be closed
  }
}

async function cleanupSession(session: ScrubSession) {
  for (const tabId of session.inFlightTabIds) {
    sessionByTabId.delete(tabId);
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
      console.warn("[ytdl:scrub-bg] windows.create failed, falling back to user's window:", error);
    }

    if (typeof windowId !== "number") {
      console.log("[ytdl:scrub-bg] using sender's window for scrub tabs");
    }

    const session: ScrubSession = {
      videoId: data.videoId,
      expectedCount,
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

    console.log(`[ytdl:scrub-bg] starting ${expectedCount} scrub tabs for ${data.videoId} in window ${windowId}`);
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
    if (totalBytes < MIN_ACCEPTABLE_TOTAL_BYTES && attempts < MAX_RETRIES_PER_INDEX) {
      session.attemptsByIndex.set(data.scrubIndex, attempts + 1);
      session.pendingIndices.push(data.scrubIndex);
      console.warn(`[ytdl:scrub-bg] segment ${data.scrubIndex} undersized (${totalBytes}B), retrying (attempt ${attempts + 2}/${MAX_RETRIES_PER_INDEX + 1})`);
      await fillTabSlots(session);
      return;
    }

    session.receivedSegments.set(data.scrubIndex, {
      videoBase64: data.videoBase64,
      audioBase64: data.audioBase64,
      videoMimeType: data.videoMimeType,
      audioMimeType: data.audioMimeType
    });

    console.log(`[ytdl:scrub-bg] received segment ${data.scrubIndex + 1}/${session.expectedCount} for ${data.videoId} (${totalBytes}B)`);

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

  onMessage(MessageType.CancelDownload, async ({ data }) => {
    for (const videoId of data.videoIds) {
      const session = sessionsByVideoId.get(videoId);
      if (session) {
        await cleanupSession(session);
      }
    }
  });
}

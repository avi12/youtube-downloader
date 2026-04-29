import type { ReceivedSegment, ScrubSession, StartIframeScrubArgs } from "./scrub-session-types";

export const sessionsByVideoId = new Map<string, ScrubSession>();
export const iframeIdByVideoIdAndIndex = new Map<string, string>();
export const deadlineTimersByIframeId = new Map<string, ReturnType<typeof setTimeout>>();
export const globalInFlightIframeIds = new Set<string>();
export let roundRobinCursor = 0;

export function setRoundRobinCursor(value: number) {
  roundRobinCursor = value;
}

export function makeIframeKey(videoId: string, scrubIndex: number) {
  return `${videoId}:${scrubIndex}`;
}

export function makeIframeId(videoId: string, scrubIndex: number, attempt: number) {
  return `${videoId}:${scrubIndex}:${attempt}`;
}

export function buildSession(data: StartIframeScrubArgs, stepSec: number, expectedCount: number): ScrubSession {
  return {
    videoId: data.videoId,
    expectedCount,
    stepSec,
    receivedSegments: new Map(),
    pendingIndices: Array.from({ length: expectedCount }, (_, i) => i),
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
    resolvedAudioMimeType: "",
    additionalAudioFormats: data.additionalAudioFormats ?? [],
    resolvedExtraAudioUrls: data.resolvedExtraAudioUrls ?? [],
    captionTracks: data.captionTracks ?? [],
    durationSec: data.durationSec
  };
}

export function pickNextWorkRoundRobin() {
  const sessions = Array.from(sessionsByVideoId.values());
  for (let offset = 0; offset < sessions.length; offset++) {
    const iSession = (roundRobinCursor + offset) % sessions.length;
    const session = sessions[iSession];
    const scrubIndex = session.pendingIndices.shift();
    if (scrubIndex === undefined) {
      continue;
    }

    setRoundRobinCursor((iSession + 1) % sessions.length);
    return {
      session,
      scrubIndex
    };
  }

  return null;
}

export function recordEmptyAfterRetries({ session, scrubIndex, logFn }: {
  session: ScrubSession;
  scrubIndex: number;
  logFn: (msg: string) => void;
}) {
  logFn(`index ${scrubIndex} exhausted retries, accepting empty`);
  session.receivedSegments.set(
    scrubIndex, {
      videoBase64: "",
      audioBase64: "",
      videoMimeType: "",
      audioMimeType: ""
    } satisfies ReceivedSegment
  );
}

export function rememberResolvedMimes({ session, segment }: {
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

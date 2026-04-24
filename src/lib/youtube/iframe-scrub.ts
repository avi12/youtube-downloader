/**
 * Iframe-scrub download: bypass YouTube's long-video attestation wall by
 * reloading a hidden player iframe at successive `&t=N` positions and
 * harvesting the bytes the player's own (server-trusted) SABR session writes
 * through `sourcebuffer-capture.content.ts`'s `appendBuffer` hook.
 *
 * Each iframe:
 *  - Loads `/watch?v=X&t=N&ytdl=1&ytdlKeepPlaying=1` as a 1×1 hidden frame.
 *  - Player initializes at `t=N` and fetches init + media fragments around N.
 *  - We keep the player PAUSED so it never autoplays (= no ad preroll).
 *  - Captured chunks land in `iframe.contentWindow.__ytdlCapture.capturedMedia[videoId]`.
 *
 * First iframe's first chunk is the init segment (moov/EBML header) — we keep
 * it. Subsequent iframes also emit their own init; we skip theirs (first-chunk
 * heuristic) since a single init is all FFmpeg needs. Media fragments may
 * overlap at seams depending on the player's buffer-ahead window; naive concat
 * lets the downstream muxer dedupe by media timestamps.
 */

const DEFAULT_STEP_SEC = 30;
const POLL_INTERVAL_MS = 400;
const STABLE_READINGS_REQUIRED = 3;
const PER_IFRAME_TIMEOUT_MS = 25_000;
const IFRAME_ATTR = "data-ytdl-scrub-frame";

interface CapturedMediaSnapshot {
  videoChunks: Uint8Array[];
  audioChunks: Uint8Array[];
  videoTotalBytes: number;
  audioTotalBytes: number;
  videoMimeType: string;
  audioMimeType: string;
}

function readCaptureFromIframe(iframe: HTMLIFrameElement, videoId: string): CapturedMediaSnapshot | null {
  type IframeWindow = Window & { __ytdlCapture?: typeof window.__ytdlCapture };
  const iframeWindow: IframeWindow | null = iframe.contentWindow ?? null;
  const capture = iframeWindow?.__ytdlCapture;
  if (!capture) {
    return null;
  }

  const media = capture.capturedMedia.get(videoId);
  if (!media) {
    return null;
  }

  return media;
}

function injectScrubIframe(videoId: string, startSec: number) {
  const elFrame = document.createElement("iframe");
  elFrame.setAttribute(IFRAME_ATTR, `${videoId}:${startSec}`);
  const hasT = startSec > 0 ? `&t=${startSec}` : "";
  elFrame.src = `https://www.youtube.com/watch?v=${videoId}&ytdl=1&ytdlKeepPlaying=1${hasT}`;
  elFrame.style.cssText = "position:fixed;width:1px;height:1px;left:-9999px;opacity:0;pointer-events:none";
  document.body.append(elFrame);
  return elFrame;
}

async function waitForStableCapture(iframe: HTMLIFrameElement, videoId: string): Promise<CapturedMediaSnapshot | null> {
  const deadline = Date.now() + PER_IFRAME_TIMEOUT_MS;
  let lastTotal = -1;
  let stableCount = 0;
  while (Date.now() < deadline) {
    const capture = readCaptureFromIframe(iframe, videoId);
    if (capture) {
      const total = capture.videoTotalBytes + capture.audioTotalBytes;
      if (total > 0 && total === lastTotal) {
        stableCount++;

        if (stableCount >= STABLE_READINGS_REQUIRED) {
          return capture;
        }
      } else {
        stableCount = 0;
        lastTotal = total;
      }
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return readCaptureFromIframe(iframe, videoId);
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export interface IframeScrubSegment {
  video: Uint8Array;
  audio: Uint8Array;
}

export interface IframeScrubResult {
  segments: IframeScrubSegment[];
  videoMimeType: string;
  audioMimeType: string;
}

export async function downloadViaIframeScrub({ videoId, durationSec, stepSec = DEFAULT_STEP_SEC, onProgress, signal }: {
  videoId: string;
  durationSec: number;
  stepSec?: number;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}): Promise<IframeScrubResult> {
  const segments: IframeScrubSegment[] = [];
  let videoMimeType = "";
  let audioMimeType = "";

  const steps = Math.max(1, Math.ceil(durationSec / stepSec));
  console.log(`[ytdl:iframe-scrub] beginning ${steps} iterations, step=${stepSec}s, duration=${durationSec}s`);
  for (let i = 0; i < steps; i++) {
    if (signal?.aborted) {
      console.log(`[ytdl:iframe-scrub] signal aborted at i=${i}`);
      break;
    }

    const startSec = i * stepSec;
    console.log(`[ytdl:iframe-scrub] iter ${i + 1}/${steps} starting at t=${startSec}s`);
    const iframe = injectScrubIframe(videoId, startSec);
    try {
      const captured = await waitForStableCapture(iframe, videoId);
      if (!captured) {
        console.warn(`[ytdl:iframe-scrub] no capture at t=${startSec}`);
        continue;
      }

      // Each iframe's capture is a self-contained fMP4/WebM segment (its own
      // init + its own media fragments, in playback order). Keep them separate
      // so the downstream muxer can run FFmpeg's concat demuxer, which handles
      // timestamp discontinuities at the seams where iframe N's fragments
      // overlap iframe N+1's.
      segments.push({
        video: concatChunks(captured.videoChunks),
        audio: concatChunks(captured.audioChunks)
      });

      if (!videoMimeType) {
        videoMimeType = captured.videoMimeType;
      }

      if (!audioMimeType) {
        audioMimeType = captured.audioMimeType;
      }

      console.log(`[ytdl:iframe-scrub] t=${startSec}s video=${captured.videoTotalBytes}B audio=${captured.audioTotalBytes}B`);
    } finally {
      iframe.remove();
    }

    onProgress?.(Math.min((i + 1) / steps, 1));
  }

  return {
    segments,
    videoMimeType,
    audioMimeType
  };
}

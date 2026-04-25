// Iframes load /watch?v=X&t=N&ytdl=1&ytdlScrubMode=1 with autoplay enabled but
// audio muted (sourcebuffer-capture forces muted/volume setters). The player's
// own SABR session fetches media as it plays — we wait for any ad preroll to
// clear (via the .html5-video-player.ad-showing class) and for the buffer to
// fill the step window, then snapshot and pause. We DON'T wipe the capture
// after the ad: the init segment is sent once per MediaSource, so wiping
// would leave media-only chunks FFmpeg can't decode. Ad bytes mixed at the
// head of a segment fall ahead of the &t=N target time and the concat demuxer
// keeps the content fragments after them.
// Each &t=N gets an independent SABR session so iframes run in parallel.

const DEFAULT_STEP_SEC = 30;
const POLL_INTERVAL_MS = 250;
const PER_IFRAME_MAX_MS = 60_000;
const PLAYER_READY_TIMEOUT_MS = 15_000;
const AD_CLEAR_TIMEOUT_MS = 35_000;
const BUFFER_FILL_MS = 25_000;
const MAX_PARALLEL_IFRAMES = 2;
const IFRAME_ATTR = "data-ytdl-scrub-frame";
const AD_SHOWING_SELECTOR = ".html5-video-player.ad-showing";
const SKIP_AD_BUTTON_SELECTOR = ".ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button";
const MOVIE_PLAYER_SELECTOR = "#movie_player";

interface IframePlayer extends HTMLElement {
  playVideo?: () => void;
  pauseVideo?: () => void;
  stopVideo?: () => void;
}

interface CapturedMediaSnapshot {
  videoChunks: Uint8Array[];
  audioChunks: Uint8Array[];
  videoTotalBytes: number;
  audioTotalBytes: number;
  videoMimeType: string;
  audioMimeType: string;
}

type IframeWindow = Window & { __ytdlCapture?: typeof window.__ytdlCapture };

function getIframeWindow(iframe: HTMLIFrameElement): IframeWindow | null {
  const win = iframe.contentWindow;
  if (!win) {
    return null;
  }

  return win;
}

function readCaptureFromIframe(iframe: HTMLIFrameElement, videoId: string): CapturedMediaSnapshot | null {
  const capture = getIframeWindow(iframe)?.__ytdlCapture;
  return capture?.capturedMedia.get(videoId) ?? null;
}

function injectScrubIframe(videoId: string, startSec: number) {
  const elFrame = document.createElement("iframe");
  elFrame.setAttribute(IFRAME_ATTR, `${videoId}:${startSec}`);
  const hasT = startSec > 0 ? `&t=${startSec}` : "";
  elFrame.src = `https://www.youtube.com/watch?v=${videoId}&ytdl=1&ytdlScrubMode=1${hasT}`;
  // 480x270 (16:9) keeps Firefox from throttling video fetch the way it does
  // for 1x1 / hidden frames. Position it offscreen so the user sees nothing.
  elFrame.style.cssText = "position:fixed;width:480px;height:270px;left:-9999px;top:-9999px;pointer-events:none";
  document.body.append(elFrame);
  return elFrame;
}

function removeAllScrubFrames() {
  for (const elFrame of document.querySelectorAll<HTMLIFrameElement>(`iframe[${IFRAME_ATTR}]`)) {
    elFrame.remove();
  }
}

function wait(durationMs: number) {
  return new Promise(resolve => setTimeout(resolve, durationMs));
}

async function pollUntil({ predicate, intervalMs, deadlineAt }: {
  predicate: () => boolean;
  intervalMs: number;
  deadlineAt: number;
}) {
  while (Date.now() < deadlineAt) {
    if (predicate()) {
      return true;
    }

    await wait(intervalMs);
  }

  return predicate();
}

function getIframePlayer(iframe: HTMLIFrameElement) {
  return iframe.contentDocument?.querySelector<IframePlayer>(MOVIE_PLAYER_SELECTOR) ?? null;
}

function isAdShowing(iframe: HTMLIFrameElement) {
  return Boolean(iframe.contentDocument?.querySelector(AD_SHOWING_SELECTOR));
}

function tryClickSkipAd(iframe: HTMLIFrameElement) {
  const skipButton = iframe.contentDocument?.querySelector<HTMLButtonElement>(SKIP_AD_BUTTON_SELECTOR);
  skipButton?.click();
}

async function waitForPlayerReady(iframe: HTMLIFrameElement) {
  const deadlineAt = Date.now() + PLAYER_READY_TIMEOUT_MS;
  await pollUntil({
    predicate: () => Boolean(getIframePlayer(iframe)?.playVideo),
    intervalMs: POLL_INTERVAL_MS,
    deadlineAt
  });
  return getIframePlayer(iframe);
}

async function waitForAdToClear(iframe: HTMLIFrameElement) {
  const deadlineAt = Date.now() + AD_CLEAR_TIMEOUT_MS;
  while (Date.now() < deadlineAt) {
    if (!isAdShowing(iframe)) {
      return;
    }

    tryClickSkipAd(iframe);
    await wait(POLL_INTERVAL_MS);
  }
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

interface ScrubTask {
  index: number;
  startSec: number;
}

interface ScrubOutput {
  segment: IframeScrubSegment;
  videoMimeType: string;
  audioMimeType: string;
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

async function captureOneIframe({ videoId, task, signal }: {
  videoId: string;
  task: ScrubTask;
  signal?: AbortSignal;
}): Promise<ScrubOutput | null> {
  if (signal?.aborted) {
    return null;
  }

  const iframeStartedAt = Date.now();
  console.log(`[ytdl:iframe-scrub] iter ${task.index + 1} starting at t=${task.startSec}s`);
  const iframe = injectScrubIframe(videoId, task.startSec);
  try {
    const player = await waitForPlayerReady(iframe);
    if (!player) {
      console.warn(`[ytdl:iframe-scrub] player never ready at t=${task.startSec}`);
      return null;
    }

    await waitForAdToClear(iframe);

    const remainingMs = PER_IFRAME_MAX_MS - (Date.now() - iframeStartedAt);
    await wait(Math.min(BUFFER_FILL_MS, Math.max(0, remainingMs)));

    player.pauseVideo?.();

    const captured = readCaptureFromIframe(iframe, videoId);
    if (!captured || captured.audioTotalBytes === 0) {
      console.warn(`[ytdl:iframe-scrub] empty capture at t=${task.startSec}`);
      return null;
    }

    console.log(`[ytdl:iframe-scrub] t=${task.startSec}s video=${captured.videoTotalBytes}B audio=${captured.audioTotalBytes}B`);
    return {
      segment: {
        video: concatChunks(captured.videoChunks),
        audio: concatChunks(captured.audioChunks)
      },
      videoMimeType: captured.videoMimeType,
      audioMimeType: captured.audioMimeType
    };
  } finally {
    iframe.remove();
  }
}

export async function downloadViaIframeScrub({ videoId, durationSec, stepSec = DEFAULT_STEP_SEC, onProgress, signal }: {
  videoId: string;
  durationSec: number;
  stepSec?: number;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}): Promise<IframeScrubResult> {
  const steps = Math.max(1, Math.ceil(durationSec / stepSec));
  console.log(`[ytdl:iframe-scrub] beginning ${steps} iterations, step=${stepSec}s, duration=${durationSec}s, parallel=${MAX_PARALLEL_IFRAMES}`);

  const queue: ScrubTask[] = Array.from({ length: steps }, (_, index) => ({
    index,
    startSec: index * stepSec
  }));
  const results: (ScrubOutput | null)[] = new Array(steps).fill(null);
  let completed = 0;

  function abortHandler() {
    console.log("[ytdl:iframe-scrub] aborted, removing all in-flight iframes");
    removeAllScrubFrames();
  }

  signal?.addEventListener("abort", abortHandler);

  async function runWorker() {
    while (queue.length > 0) {
      if (signal?.aborted) {
        return;
      }

      const task = queue.shift();
      if (!task) {
        return;
      }

      const output = await captureOneIframe({
        videoId,
        task,
        signal
      });
      results[task.index] = output;
      completed++;
      onProgress?.(Math.min(completed / steps, 1));
    }
  }

  try {
    const workerCount = Math.min(MAX_PARALLEL_IFRAMES, steps);
    await Promise.all(
      Array.from({ length: workerCount }, () => runWorker())
    );
  } finally {
    signal?.removeEventListener("abort", abortHandler);
    removeAllScrubFrames();
  }

  const segments: IframeScrubSegment[] = [];
  let videoMimeType = "";
  let audioMimeType = "";
  for (const result of results) {
    if (!result) {
      continue;
    }

    segments.push(result.segment);

    if (!videoMimeType) {
      videoMimeType = result.videoMimeType;
    }

    if (!audioMimeType) {
      audioMimeType = result.audioMimeType;
    }
  }

  return {
    segments,
    videoMimeType,
    audioMimeType
  };
}

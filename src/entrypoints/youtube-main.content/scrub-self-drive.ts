import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";

const POLL_INTERVAL_MS = 250;
const PLAYER_READY_TIMEOUT_MS = 15_000;
const AD_CLEAR_TIMEOUT_MS = 35_000;
const BUFFER_FILL_MS = 25_000;
const AD_SHOWING_SELECTOR = ".html5-video-player.ad-showing";
const SKIP_AD_BUTTON_SELECTOR = ".ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button";
const MOVIE_PLAYER_SELECTOR = "#movie_player";

interface MoviePlayer extends HTMLElement {
  playVideo?: () => void;
  pauseVideo?: () => void;
  stopVideo?: () => void;
}

function wait(durationMs: number) {
  return new Promise(resolve => setTimeout(resolve, durationMs));
}

function getMoviePlayer() {
  return document.querySelector<MoviePlayer>(MOVIE_PLAYER_SELECTOR);
}

async function waitForPlayerReady() {
  const deadlineAt = Date.now() + PLAYER_READY_TIMEOUT_MS;
  while (Date.now() < deadlineAt) {
    const player = getMoviePlayer();
    if (player?.playVideo) {
      return player;
    }

    await wait(POLL_INTERVAL_MS);
  }

  return null;
}

async function waitForAdToClear() {
  const deadlineAt = Date.now() + AD_CLEAR_TIMEOUT_MS;
  while (Date.now() < deadlineAt) {
    if (!document.querySelector(AD_SHOWING_SELECTOR)) {
      return;
    }

    document.querySelector<HTMLButtonElement>(SKIP_AD_BUTTON_SELECTOR)?.click();
    await wait(POLL_INTERVAL_MS);
  }
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

function sendEmptyResult({ videoId, scrubIndex }: {
  videoId: string;
  scrubIndex: number;
}) {
  void crossWorldMessenger.sendMessage(CrossWorldMessage.IframeScrubSegment, {
    videoId,
    scrubIndex,
    videoBytes: new Uint8Array(),
    audioBytes: new Uint8Array(),
    videoMimeType: "",
    audioMimeType: ""
  });
}

export async function runScrubSelfDrive() {
  const params = new URLSearchParams(location.search);
  const scrubIndex = parseInt(params.get("ytdlScrubIndex") ?? "-1", 10);
  const videoId = params.get("v") ?? "";
  if (scrubIndex < 0 || !videoId) {
    console.warn("[ytdl:scrub-tab] missing scrub index or videoId");
    return;
  }

  console.log(`[ytdl:scrub-tab] self-drive started, videoId=${videoId} index=${scrubIndex}`);

  const player = await waitForPlayerReady();
  if (!player) {
    console.warn(`[ytdl:scrub-tab] player never ready, index=${scrubIndex}`);
    sendEmptyResult({
      videoId,
      scrubIndex
    });
    return;
  }

  await waitForAdToClear();
  await wait(BUFFER_FILL_MS);
  player.pauseVideo?.();

  const captured = window.__ytdlCapture?.capturedMedia.get(videoId);
  if (!captured || captured.audioTotalBytes === 0) {
    console.warn(`[ytdl:scrub-tab] empty capture, index=${scrubIndex}`);
    sendEmptyResult({
      videoId,
      scrubIndex
    });
    return;
  }

  console.log(`[ytdl:scrub-tab] captured index=${scrubIndex} video=${captured.videoTotalBytes}B audio=${captured.audioTotalBytes}B`);

  void crossWorldMessenger.sendMessage(CrossWorldMessage.IframeScrubSegment, {
    videoId,
    scrubIndex,
    videoBytes: concatChunks(captured.videoChunks),
    audioBytes: concatChunks(captured.audioChunks),
    videoMimeType: captured.videoMimeType,
    audioMimeType: captured.audioMimeType
  });
}

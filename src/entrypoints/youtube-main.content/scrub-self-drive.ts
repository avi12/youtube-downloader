import { buildSyntheticTemplateFromPlayer } from "../sabr-fetch-interceptor.content";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { uint8ToBase64 } from "@/lib/utils/binary";

function scrubLog(msg: string) {
  console.log(`[ytdl:scrub-tab] ${msg}`);
  void crossWorldMessenger.sendMessage(CrossWorldMessage.IframeScrubDebug, {
    msg: `[ytdl:scrub-tab] ${msg}`
  });
}

const POLL_INTERVAL_MS = 250;
const PLAYER_READY_TIMEOUT_MS = 15_000;
const PLAYBACK_START_TIMEOUT_MS = 15_000;
const AD_APPEAR_WAIT_MS = 5_000;
const AD_CLEAR_TIMEOUT_MS = 30_000;
const STALL_GRACE_MS = 4_000;
const MIN_AUDIO_BYTES = 200_000;
const BUFFER_FILL_OVERHEAD_MS = 30_000;
const AD_SHOWING_SELECTOR = ".html5-video-player.ad-showing";
const SKIP_AD_BUTTON_SELECTOR = ".ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button";
const MOVIE_PLAYER_SELECTOR = "#movie_player";
const VIDEO_ELEMENT_SELECTOR = "video";

interface MoviePlayer extends HTMLElement {
  playVideo?: () => void;
  pauseVideo?: () => void;
  stopVideo?: () => void;
  getDuration?: () => number;
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
    if (player?.playVideo && player.getDuration?.() && player.getDuration() > 0) {
      return player;
    }

    await wait(POLL_INTERVAL_MS);
  }

  return null;
}

// player.playVideo() relies on the youtube.com autoplay heuristic; inside a
// hidden iframe hosted by an extension page Firefox blocks unmuted autoplay
// even with allow="autoplay". Setting <video>.muted=true unconditionally
// satisfies the muted-autoplay path and lets play() resolve, after which the
// player fetches media segments normally (audio bytes are still captured by
// the SourceBuffer hook regardless of <video> mute state).
async function forcePlayback(player: MoviePlayer) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < PLAYBACK_START_TIMEOUT_MS) {
    const elVideo = document.querySelector<HTMLVideoElement>(VIDEO_ELEMENT_SELECTOR);
    if (elVideo) {
      elVideo.muted = true;
      try {
        await elVideo.play();
      } catch {
        // first play() may reject before player.playVideo() arms autoplay;
        // we keep retrying.
      }
    }

    player.playVideo?.();
    await wait(POLL_INTERVAL_MS);

    if (elVideo && (!elVideo.paused || elVideo.currentTime > 0 || elVideo.readyState >= 2)) {
      return true;
    }
  }

  return false;
}

async function waitForAdToClear() {
  const appearDeadline = Date.now() + AD_APPEAR_WAIT_MS;
  while (Date.now() < appearDeadline) {
    if (document.querySelector(AD_SHOWING_SELECTOR)) {
      break;
    }

    await wait(POLL_INTERVAL_MS);
  }

  if (!document.querySelector(AD_SHOWING_SELECTOR)) {
    return;
  }

  const clearDeadline = Date.now() + AD_CLEAR_TIMEOUT_MS;
  while (Date.now() < clearDeadline) {
    if (!document.querySelector(AD_SHOWING_SELECTOR)) {
      return;
    }

    // Crank rate so non-skippable ads finish in seconds rather than ~2 min,
    // and click skip-ad as soon as it appears.
    const elVideo = document.querySelector<HTMLVideoElement>(VIDEO_ELEMENT_SELECTOR);
    if (elVideo) {
      elVideo.playbackRate = 16;
    }

    document.querySelector<HTMLButtonElement>(SKIP_AD_BUTTON_SELECTOR)?.click();
    await wait(POLL_INTERVAL_MS);
  }
}

// Drives a hidden BG factory iframe: best-effort triggers the player to fire
// its first SABR call (which the interceptor captures with its ad filter
// disabled in factory mode). We don't insist on playback or ad-clear because
// hidden BG iframes can't reliably autoplay; the player still issues its
// initial SABR call to fetch init segments even when paused.
const FACTORY_FIRST_CALL_WAIT_MS = 15_000;

export async function runTrustFactoryDrive() {
  console.log("[ytdl:trust-factory-tab] starting");

  const player = await waitForPlayerReady();
  if (!player) {
    console.warn("[ytdl:trust-factory-tab] player never ready");
    return;
  }

  // First try: synthesize the SABR template from MAIN-world player state
  // immediately. This works without playback and side-steps the case where the
  // hidden iframe player can't autoplay (so the network interceptor never sees
  // a real SABR call). We still publish via the same SabrTemplateCaptured
  // message the network interceptor uses, so the BG forwarding path is
  // unchanged.
  const synthetic = buildSyntheticTemplateFromPlayer();
  if (synthetic) {
    console.log("[ytdl:trust-factory-tab] synthesized template", {
      url: synthetic.url,
      bodyLen: synthetic.body.byteLength
    });
    window.__ytdlSabrTemplate = synthetic;
    void crossWorldMessenger.sendMessage(CrossWorldMessage.SabrTemplateCaptured, {
      url: synthetic.url,
      bodyBase64: uint8ToBase64(synthetic.body),
      capturedAt: synthetic.capturedAt
    });
    return;
  }

  // Fallback: kick playback (muted) and idle while the network interceptor
  // captures whichever SABR call fires first.
  console.log("[ytdl:trust-factory-tab] synthesis failed, falling back to interceptor capture");
  void forcePlayback(player);
  await wait(FACTORY_FIRST_CALL_WAIT_MS);
  console.log("[ytdl:trust-factory-tab] idle window elapsed");
}

function bindCaptureToVideoIdDiscardingPending(videoId: string) {
  const captureState = window.__ytdlCapture;
  if (!captureState) {
    return;
  }

  captureState.pendingChunks.length = 0;
  captureState.activeVideoId = videoId;

  if (!captureState.capturedMedia.has(videoId)) {
    captureState.capturedMedia.set(videoId, {
      videoChunks: [],
      audioChunks: [],
      videoMimeType: "video/mp4",
      audioMimeType: "audio/mp4",
      videoTotalBytes: 0,
      audioTotalBytes: 0
    });
    return;
  }

  const capture = captureState.capturedMedia.get(videoId);
  if (capture) {
    capture.videoChunks.length = 0;
    capture.audioChunks.length = 0;
    capture.videoTotalBytes = 0;
    capture.audioTotalBytes = 0;
  }
}

async function waitForBufferFill({ videoId, windowSec, player }: {
  videoId: string;
  windowSec: number;
  player: MoviePlayer;
}) {
  const hardCapMs = windowSec * 1000 + BUFFER_FILL_OVERHEAD_MS;
  const startedAt = Date.now();
  let lastAudioBytes = 0;
  let lastChangeAt = Date.now();

  while (Date.now() - startedAt < hardCapMs) {
    const elVideo = document.querySelector<HTMLVideoElement>(VIDEO_ELEMENT_SELECTOR);
    if (elVideo?.paused) {
      player.playVideo?.();
      try {
        await elVideo.play();
      } catch (_) {
        // browser may reject play() under restrictive autoplay; we keep retrying
      }
    }

    const captured = window.__ytdlCapture?.capturedMedia.get(videoId);
    const currentBytes = captured?.audioTotalBytes ?? 0;
    if (currentBytes !== lastAudioBytes) {
      lastAudioBytes = currentBytes;
      lastChangeAt = Date.now();
    } else if (currentBytes > MIN_AUDIO_BYTES && Date.now() - lastChangeAt > STALL_GRACE_MS) {
      return;
    }

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
  const windowSec = parseInt(params.get("ytdlScrubWindow") ?? "30", 10);
  if (scrubIndex < 0 || !videoId) {
    scrubLog("missing scrub index or videoId");
    return;
  }

  scrubLog(`scrub start videoId=${videoId} index=${scrubIndex} window=${windowSec}s captureState=${window.__ytdlCapture ? "present" : "missing"}`);

  const player = await waitForPlayerReady();
  if (!player) {
    scrubLog(`player never ready index=${scrubIndex}`);
    sendEmptyResult({
      videoId,
      scrubIndex
    });
    return;
  }

  scrubLog(`player ready index=${scrubIndex} duration=${player.getDuration?.() ?? 0}`);

  const isPlaying = await forcePlayback(player);
  if (!isPlaying) {
    scrubLog(`playback never started index=${scrubIndex}`);
    sendEmptyResult({
      videoId,
      scrubIndex
    });
    return;
  }

  scrubLog(`playback started index=${scrubIndex}`);

  await waitForAdToClear();
  scrubLog(`ad cleared index=${scrubIndex}`);

  bindCaptureToVideoIdDiscardingPending(videoId);
  scrubLog(`capture bound index=${scrubIndex} captureState=${window.__ytdlCapture ? "present" : "missing"}`);

  await waitForBufferFill({
    videoId,
    windowSec,
    player
  });
  player.pauseVideo?.();

  const captured = window.__ytdlCapture?.capturedMedia.get(videoId);
  scrubLog(`buffer fill done index=${scrubIndex} audioBytes=${captured?.audioTotalBytes ?? 0} videoBytes=${captured?.videoTotalBytes ?? 0}`);

  if (!captured || captured.audioTotalBytes === 0) {
    scrubLog(`empty capture index=${scrubIndex}`);
    sendEmptyResult({
      videoId,
      scrubIndex
    });
    return;
  }

  const videoConcat = concatChunks(captured.videoChunks);
  const audioConcat = concatChunks(captured.audioChunks);
  scrubLog(`segment posting index=${scrubIndex} videoBytes=${videoConcat.byteLength} audioBytes=${audioConcat.byteLength}`);

  void crossWorldMessenger.sendMessage(CrossWorldMessage.IframeScrubSegment, {
    videoId,
    scrubIndex,
    videoBytes: videoConcat,
    audioBytes: audioConcat,
    videoMimeType: captured.videoMimeType,
    audioMimeType: captured.audioMimeType
  });

  scrubLog(`segment posted index=${scrubIndex}`);
}

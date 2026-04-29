import { buildSyntheticTemplateFromPlayer } from "../sabr-fetch-interceptor.content";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { uint8ToBase64 } from "@/lib/utils/binary";
import {
  AD_SHOWING_SELECTOR,
  MOVIE_PLAYER_SELECTOR,
  SKIP_AD_BUTTON_SELECTOR,
  VIDEO_ELEMENT_SELECTOR
} from "@/lib/youtube/player-selectors";

// Direct postMessage channel for BG-hosted iframes. Firefox doesn't inject
// content scripts into iframes whose top-level document is moz-extension://,
// so the cross-world → ISOLATED → runtime.sendMessage relay is silently
// dropped. parent.postMessage works regardless because postMessage is a DOM
// primitive that crosses any origin; the BG document hosts the iframe and
// listens for these messages directly.
const POST_MESSAGE_TYPE_DEBUG = "ytdl:scrub-debug";
const POST_MESSAGE_TYPE_SEGMENT = "ytdl:scrub-segment";

function postToHost(payload: unknown, transferables: Transferable[] = []) {
  if (parent === self) {
    return;
  }

  try {
    parent.postMessage(payload, "*", transferables);
  } catch {
    // best-effort
  }
}

function scrubLog(msg: string) {
  console.log(`[ytdl:scrub-tab] ${msg}`);
  void crossWorldMessenger.sendMessage(CrossWorldMessage.IframeScrubDebug, {
    msg: `[ytdl:scrub-tab] ${msg}`
  });
  postToHost({
    type: POST_MESSAGE_TYPE_DEBUG,
    msg: `[ytdl:scrub-tab] ${msg}`
  });
}

const POLL_INTERVAL_MS = 250;
const PLAYER_READY_TIMEOUT_MS = 15_000;
const PLAYBACK_START_TIMEOUT_MS = 15_000;
const AD_APPEAR_WAIT_MS = 5_000;
const AD_CLEAR_TIMEOUT_MS = 30_000;
// Long enough that bursty fragment loads with ≤5s inter-burst gaps don't
// trigger a premature exit before the player has finished the windowSec
// buffer-ahead.
const STALL_GRACE_MS = 12_000;
const MIN_AUDIO_BYTES = 200_000;
const BUFFER_FILL_OVERHEAD_MS = 60_000;
const BUFFER_STALL_SEEK_MS = 2_000;

interface MoviePlayer extends HTMLElement {
  playVideo?: () => void;
  pauseVideo?: () => void;
  stopVideo?: () => void;
  seekTo?: (seconds: number, allowSeekAhead?: boolean) => void;
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
      // Fire-and-forget: in Firefox background tabs, play() may return a
      // Promise that never settles, which would hang the loop if awaited.
      void elVideo.play().catch(() => {});
    }

    player.playVideo?.();
    await wait(POLL_INTERVAL_MS);

    if (elVideo && (!elVideo.paused || elVideo.currentTime > 0 || elVideo.readyState >= 2)) {
      // Unmute now that playback started — YouTube SABR skips audio fetching
      // when the media element is muted; we only muted above to satisfy
      // Firefox's background-tab autoplay policy.
      elVideo.muted = false;
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
    return false;
  }

  try {
    const clearDeadline = Date.now() + AD_CLEAR_TIMEOUT_MS;
    while (Date.now() < clearDeadline) {
      if (!document.querySelector(AD_SHOWING_SELECTOR)) {
        return true;
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

    return true;
  } finally {
    // Reset to 1x once the ad clears — otherwise waitForBufferFill keeps the
    // player at 16x speed and a single iframe blows through ~24 minutes of
    // media in 90s, capturing the entire rest of the video instead of its
    // intended 60s window.
    const elVideo = document.querySelector<HTMLVideoElement>(VIDEO_ELEMENT_SELECTOR);
    if (elVideo) {
      elVideo.playbackRate = 1;
    }
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

// When an ad ran, pendingChunks contain a mix of the ad's own streams and
// real-video pre-fetches from the wrong time offset. Media fragments (large
// chunks) at the wrong position would corrupt the capture; init segments
// (ftyp+moov / EBML+Tracks, always ≤ 50 KB) are still required by FFmpeg.
// So when skipMediaFragments=true, keep only the init-sized chunks and discard
// the large media ones; let the post-seekTo fetch supply fresh media.
const PENDING_INIT_MAX_BYTES = 50_000;
function bindCaptureToVideoId(videoId: string, skipMediaFragments = false) {
  const captureState = window.__ytdlCapture;
  if (!captureState) {
    return;
  }

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
  } else {
    const capture = captureState.capturedMedia.get(videoId);
    if (capture) {
      capture.videoChunks.length = 0;
      capture.audioChunks.length = 0;
      capture.videoTotalBytes = 0;
      capture.audioTotalBytes = 0;
    }
  }

  // Flush pending pre-bind chunks. When an ad ran, skip large media fragments
  // (wrong time position) but keep small init segments (required by FFmpeg).
  const capture = captureState.capturedMedia.get(videoId);
  if (capture) {
    for (const pending of captureState.pendingChunks) {
      if (skipMediaFragments && pending.data.byteLength > PENDING_INIT_MAX_BYTES) {
        continue;
      }

      captureState.addChunkToCapture({
        capture,
        mimeType: pending.mimeType,
        chunk: pending.data
      });
    }
  }

  captureState.pendingChunks.length = 0;
}

async function waitForBufferFill({ videoId, windowSec, startSec, scrubIndex, player }: {
  videoId: string;
  windowSec: number;
  startSec: number;
  scrubIndex: number;
  player: MoviePlayer;
}) {
  const hardCapMs = windowSec * 1000 + BUFFER_FILL_OVERHEAD_MS;
  const startedAt = Date.now();
  const targetCurrentTime = startSec + windowSec;
  const initialBytes = window.__ytdlCapture?.capturedMedia.get(videoId)?.audioTotalBytes ?? 0;
  let lastAudioBytes = initialBytes;
  let lastChangeAt = Date.now();
  let hasGrownPastBaseline = false;
  // Short tail windows (< stepSec) produce less audio than a full 60s segment.
  // Skip the MIN_AUDIO_BYTES gate so we don't loop until the hard cap fires.
  const isTinyWindow = windowSec <= 10;
  let lastBufferedEnd = 0;
  let lastBufferedEndAt = Date.now();

  while (Date.now() - startedAt < hardCapMs) {
    const elVideo = document.querySelector<HTMLVideoElement>(VIDEO_ELEMENT_SELECTOR);
    if (elVideo?.paused) {
      elVideo.muted = true;
      player.playVideo?.();
      void elVideo.play().catch(() => {});
      elVideo.muted = false;
    }

    let currentBufferedEnd = lastBufferedEnd;
    if (elVideo && !isTinyWindow) {
      currentBufferedEnd = elVideo.buffered.length > 0
        ? elVideo.buffered.end(elVideo.buffered.length - 1)
        : 0;

      // Fast path: buffer covers the full window — both audio and video are
      // buffered (video.buffered returns the intersection of all SourceBuffers).
      if (
        currentBufferedEnd >= targetCurrentTime - 0.5
        && (isTinyWindow || (window.__ytdlCapture?.capturedMedia.get(videoId)?.audioTotalBytes ?? 0) > MIN_AUDIO_BYTES)
      ) {
        return;
      }

      // Buffer-edge seek: SABR only fetches the next audio chunk when the player's
      // currentTime approaches the buffer edge. When pendingChunks pre-populate
      // the capture with init+early-media (e.g. 37s buffered for a 60s window),
      // the player's currentTime stays near 0 and SABR never requests 37-60s.
      // Seeking to buffered.end - 1 pushes currentTime to the edge and triggers
      // the continuation fetch. Threshold matches isBufferSufficient (-2) so
      // there is no dead zone where neither seek nor exit fires.
      if (currentBufferedEnd !== lastBufferedEnd) {
        lastBufferedEnd = currentBufferedEnd;
        lastBufferedEndAt = Date.now();
      } else if (
        currentBufferedEnd > 0
        && currentBufferedEnd < targetCurrentTime - 2
        && Date.now() - lastBufferedEndAt > BUFFER_STALL_SEEK_MS
      ) {
        const seekTarget = Math.max(startSec, currentBufferedEnd - 1);
        scrubLog(`buffer-edge seek index=${scrubIndex} bufferedEnd=${currentBufferedEnd.toFixed(1)} seekTarget=${seekTarget.toFixed(1)}`);
        player.seekTo?.(seekTarget, true);
        lastBufferedEndAt = Date.now();
        // Give the re-fetch time to respond before the stall-grace can fire.
        lastChangeAt = Date.now();
      }
    }

    const captured = window.__ytdlCapture?.capturedMedia.get(videoId);
    const currentBytes = captured?.audioTotalBytes ?? 0;
    if (currentBytes !== lastAudioBytes) {
      lastAudioBytes = currentBytes;
      lastChangeAt = Date.now();

      if (currentBytes > initialBytes) {
        hasGrownPastBaseline = true;
      }
    } else if (hasGrownPastBaseline && elVideo?.ended) {
      // Tail segment: player reached end of video — we have everything available.
      return;
    } else if (
      hasGrownPastBaseline
      && (isTinyWindow || currentBytes > MIN_AUDIO_BYTES)
      && Date.now() - lastChangeAt > STALL_GRACE_MS
    ) {
      // Don't exit on byte stall if the buffer hasn't covered the full window
      // yet — the player is mid-fetch and will grow more. The hard cap provides
      // the absolute timeout.
      const isBufferSufficient = isTinyWindow || currentBufferedEnd >= targetCurrentTime - 2;
      if (!isBufferSufficient) {
        lastChangeAt = Date.now();
      } else {
        return;
      }
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
  postToHost({
    type: POST_MESSAGE_TYPE_SEGMENT,
    videoId,
    scrubIndex,
    videoBuffer: new ArrayBuffer(0),
    audioBuffer: new ArrayBuffer(0),
    videoMimeType: "",
    audioMimeType: ""
  });
}

export async function runScrubSelfDrive() {
  const params = new URLSearchParams(location.search);
  const scrubIndex = parseInt(params.get("ytdlScrubIndex") ?? "-1", 10);
  const videoId = params.get("v") ?? "";
  const windowSec = parseInt(params.get("ytdlScrubWindow") ?? "30", 10);
  const startSec = parseInt(params.get("t") ?? "0", 10);
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

  const hadAd = await waitForAdToClear();
  scrubLog(`ad cleared index=${scrubIndex} hadAd=${hadAd}`);

  // Never skip media fragments even after an ad: the addSourceBuffer hook
  // already clears ad bytes from pendingChunks when the main-content
  // SourceBuffer is created, so pendingChunks only holds valid main-content
  // data (from t=0 onward). Pre-trimming in the pipeline (-ss startSec)
  // extracts only the intended window, so we never need to discard media.
  bindCaptureToVideoId(videoId, false);
  scrubLog(`capture bound index=${scrubIndex} captureState=${window.__ytdlCapture ? "present" : "missing"}`);

  if (hadAd) {
    player.seekTo?.(startSec, true);
    scrubLog(`post-ad seek to ${startSec}s index=${scrubIndex}`);
    // seekTo alone doesn't kick the SABR fetch in background tabs — force play
    // immediately so the player requests media data starting at startSec.
    const elVideoPostSeek = document.querySelector<HTMLVideoElement>(VIDEO_ELEMENT_SELECTOR);
    if (elVideoPostSeek) {
      elVideoPostSeek.muted = true;
      player.playVideo?.();
      void elVideoPostSeek.play().catch(() => {});
      elVideoPostSeek.muted = false;
    }
  }

  await waitForBufferFill({
    videoId,
    windowSec,
    startSec,
    scrubIndex,
    player
  });
  player.pauseVideo?.();

  const elVideoAfterFill = document.querySelector<HTMLVideoElement>(VIDEO_ELEMENT_SELECTOR);
  const videoBufferStartSec = elVideoAfterFill?.buffered.length
    ? elVideoAfterFill.buffered.start(0)
    : undefined;

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
    audioMimeType: captured.audioMimeType,
    videoBufferStartSec
  });

  // Slice the underlying buffers so we don't transfer the whole pool when
  // chunks live in shared backing storage; copy is cheap relative to
  // concat itself.
  const videoBuffer = videoConcat.buffer.slice(
    videoConcat.byteOffset,
    videoConcat.byteOffset + videoConcat.byteLength
  );
  const audioBuffer = audioConcat.buffer.slice(
    audioConcat.byteOffset,
    audioConcat.byteOffset + audioConcat.byteLength
  );
  postToHost({
    type: POST_MESSAGE_TYPE_SEGMENT,
    videoId,
    scrubIndex,
    videoBuffer,
    audioBuffer,
    videoMimeType: captured.videoMimeType,
    audioMimeType: captured.audioMimeType,
    videoBufferStartSec
  }, [videoBuffer, audioBuffer]);

  scrubLog(`segment posted index=${scrubIndex}`);
}

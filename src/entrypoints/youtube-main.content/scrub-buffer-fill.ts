import { wait, POLL_INTERVAL_MS, type MoviePlayer } from "./scrub-player";
import { scrubLog } from "./scrub-segment-emit";
import { VIDEO_ELEMENT_SELECTOR } from "@/lib/youtube/player-selectors";

// Long enough that bursty fragment loads with ≤5s inter-burst gaps don't
// trigger a premature exit before the player has finished the windowSec
// buffer-ahead.
const STALL_GRACE_MS = 12_000;
const MIN_AUDIO_BYTES = 200_000;
const BUFFER_FILL_OVERHEAD_MS = 60_000;
const BUFFER_STALL_SEEK_MS = 2_000;

export async function waitForBufferFill({ videoId, windowSec, startSec, scrubIndex, player }: {
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
      // Fast path: buffer covers the full window - both audio and video are
      // buffered (video.buffered returns the intersection of all SourceBuffers).
      const audioBytes = window.__ytdlCapture?.capturedMedia.get(videoId)?.audioTotalBytes ?? 0;
      if (currentBufferedEnd >= targetCurrentTime - 0.5 && audioBytes > MIN_AUDIO_BYTES) {
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
      hasGrownPastBaseline = hasGrownPastBaseline || currentBytes > initialBytes;
    } else if (hasGrownPastBaseline && elVideo?.ended) {
      // Tail segment: player reached end of video - we have everything available.
      return;
    } else if (hasGrownPastBaseline && (isTinyWindow || currentBytes > MIN_AUDIO_BYTES)
      && Date.now() - lastChangeAt > STALL_GRACE_MS) {
      // Don't exit on byte stall if the buffer hasn't covered the full window
      // yet - the player is mid-fetch and will grow more. The hard cap provides
      // the absolute timeout.
      if (isTinyWindow || currentBufferedEnd >= targetCurrentTime - 2) {
        return;
      }

      lastChangeAt = Date.now();
    }

    await wait(POLL_INTERVAL_MS);
  }
}

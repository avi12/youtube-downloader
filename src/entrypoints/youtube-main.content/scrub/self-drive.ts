import { waitForAdToClear } from "./ad-handler";
import { waitForBufferFill } from "./buffer-fill";
import { concatChunks } from "./capture";
import { waitForPlayerReady, forcePlayback, postAdSeek } from "./player";
import { scrubLog, sendCapturedResult, sendEmptyResult } from "./segment-emit";
import { VIDEO_ELEMENT_SELECTOR } from "@/lib/youtube/player-selectors";

export { runTrustFactoryDrive } from "./trust-factory";

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

  scrubLog(`scrub start videoId=${videoId} index=${scrubIndex} startSec=${startSec} window=${windowSec}s`);

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

  postAdSeek(player, startSec);
  await waitForBufferFill({
    videoId,
    windowSec,
    startSec,
    scrubIndex,
    player
  });
  scrubLog(`buffer fill complete index=${scrubIndex}`);

  const capture = window.__ytdlCapture?.capturedMedia.get(videoId);
  if (!capture || (capture.videoTotalBytes === 0 && capture.audioTotalBytes === 0)) {
    scrubLog(`no capture data index=${scrubIndex}`);
    sendEmptyResult({
      videoId,
      scrubIndex
    });
    return;
  }

  const elVideo = document.querySelector<HTMLVideoElement>(VIDEO_ELEMENT_SELECTOR);
  const bufferedEnd = elVideo && elVideo.buffered.length > 0
    ? elVideo.buffered.end(elVideo.buffered.length - 1)
    : startSec + windowSec;

  scrubLog(`emitting index=${scrubIndex} video=${capture.videoTotalBytes}B audio=${capture.audioTotalBytes}B bufferedEnd=${bufferedEnd.toFixed(1)}s`);
  sendCapturedResult({
    videoId,
    scrubIndex,
    videoBuffer: concatChunks(capture.videoChunks).buffer as ArrayBuffer,
    audioBuffer: concatChunks(capture.audioChunks).buffer as ArrayBuffer,
    videoMimeType: capture.videoMimeType,
    audioMimeType: capture.audioMimeType,
    videoBufferEndSec: bufferedEnd
  });
}

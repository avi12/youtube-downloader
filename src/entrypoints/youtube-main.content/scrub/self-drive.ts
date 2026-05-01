import { activateCaptureForVideoId } from "../video/iframe-capture-state";
import { waitForAdToClear } from "./ad-handler";
import { waitForBufferFill } from "./buffer-fill";
import { concatChunks } from "./capture";
import { waitForPlayerReady, forcePlayback, postAdSeek } from "./player";
import { scrubLog, sendCapturedResult, sendEmptyResult } from "./segment-emit";
import { VIDEO_ELEMENT_SELECTOR } from "@/lib/youtube/player-selectors";

export { runTrustFactoryDrive } from "./trust-factory";

export async function runScrubSelfDrive() {
  const params = new URLSearchParams(location.search);
  const iScrub = parseInt(params.get("ytdlScrubIndex") ?? "-1", 10);
  const videoId = params.get("v") ?? "";
  const windowSec = parseInt(params.get("ytdlScrubWindow") ?? "30", 10);
  const startSec = parseInt(params.get("t") ?? "0", 10);
  if (iScrub < 0 || !videoId) {
    scrubLog("missing scrub index or videoId");
    return;
  }

  activateCaptureForVideoId(videoId);

  scrubLog(`scrub start videoId=${videoId} index=${iScrub} startSec=${startSec} window=${windowSec}s`);

  const player = await waitForPlayerReady();
  if (!player) {
    scrubLog(`player never ready index=${iScrub}`);
    sendEmptyResult({
      videoId,
      iScrub
    });
    return;
  }

  scrubLog(`player ready index=${iScrub} duration=${player.getDuration?.() ?? 0}`);

  const isPlaying = await forcePlayback(player);
  if (!isPlaying) {
    scrubLog(`playback never started index=${iScrub}`);
    sendEmptyResult({
      videoId,
      iScrub
    });
    return;
  }

  scrubLog(`playback started index=${iScrub}`);
  await waitForAdToClear();
  scrubLog(`ad cleared index=${iScrub}`);

  postAdSeek(player, startSec);
  await waitForBufferFill({
    videoId,
    windowSec,
    startSec,
    iScrub,
    player
  });
  scrubLog(`buffer fill complete index=${iScrub}`);

  const capture = window.__ytdlCapture?.capturedMedia.get(videoId);
  if (!capture || (capture.videoTotalBytes === 0 && capture.audioTotalBytes === 0)) {
    scrubLog(`no capture data index=${iScrub}`);
    sendEmptyResult({
      videoId,
      iScrub
    });
    return;
  }

  const elVideo = document.querySelector<HTMLVideoElement>(VIDEO_ELEMENT_SELECTOR);
  const bufferedEnd = elVideo && elVideo.buffered.length > 0
    ? elVideo.buffered.end(elVideo.buffered.length - 1)
    : startSec + windowSec;

  scrubLog(`emitting index=${iScrub} video=${capture.videoTotalBytes}B audio=${capture.audioTotalBytes}B bufferedEnd=${bufferedEnd.toFixed(1)}s`);
  sendCapturedResult({
    videoId,
    iScrub,
    videoBytes: concatChunks(capture.videoChunks),
    audioBytes: concatChunks(capture.audioChunks),
    videoMimeType: capture.videoMimeType,
    audioMimeType: capture.audioMimeType,
    videoBufferEndSec: bufferedEnd
  });
}

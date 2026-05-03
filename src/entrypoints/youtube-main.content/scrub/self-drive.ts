import { fetchProgressive } from "../../sabr-fetch-interceptor/progressive-fetcher";
import { buildSyntheticTemplateFromPlayer, readScrubFormats } from "../../sabr-fetch-interceptor/template-builder";
import { waitForPlayerReady } from "./player";
import { scrubLog, sendCapturedResult, sendEmptyResult } from "./segment-emit";
import { ScrubUrlParam } from "@/lib/youtube/youtube-url";

export { runTrustFactoryDrive } from "./trust-factory";

export async function runScrubSelfDrive() {
  const params = new URLSearchParams(location.search);
  const iScrub = parseInt(params.get(ScrubUrlParam.ScrubIndex) ?? "-1", 10);
  const videoId = params.get("v") ?? "";
  const windowSec = parseInt(params.get(ScrubUrlParam.ScrubWindow) ?? "30", 10);
  const startSec = parseInt(params.get("t") ?? "0", 10);
  if (iScrub < 0 || !videoId) {
    scrubLog("missing scrub index or videoId");
    return;
  }

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

  const formats = readScrubFormats();
  const template = buildSyntheticTemplateFromPlayer();
  if (!formats || !template) {
    scrubLog(`could not synthesize SABR template index=${iScrub}`);
    sendEmptyResult({
      videoId,
      iScrub
    });
    return;
  }

  window.__ytdlSabrTemplate = template;
  scrubLog(`template ready index=${iScrub}, fetching startSec=${startSec} window=${windowSec}s`);

  const result = await fetchProgressive({
    targetDurationMs: (startSec + windowSec) * 1000,
    maxIterations: 80,
    carryState: null,
    initialPlayerTimeMs: startSec * 1000
  }).catch(error => {
    scrubLog(`fetchProgressive failed index=${iScrub}: ${String(error)}`);
    return null;
  });
  if (!result?.videoBytes.byteLength && !result?.audioBytes.byteLength) {
    scrubLog(`no bytes from fetchProgressive index=${iScrub}`);
    sendEmptyResult({
      videoId,
      iScrub
    });
    return;
  }

  scrubLog(`emitting index=${iScrub} video=${result.videoBytes.byteLength}B audio=${result.audioBytes.byteLength}B end=${(result.videoCoveredMs / 1000).toFixed(1)}s`);
  sendCapturedResult({
    videoId,
    iScrub,
    videoBytes: result.videoBytes,
    audioBytes: result.audioBytes,
    videoMimeType: formats.video.mimeType?.split(";")[0] ?? "video/mp4",
    audioMimeType: formats.audio.mimeType?.split(";")[0] ?? "audio/mp4",
    videoBufferEndSec: result.videoCoveredMs / 1000
  });
}

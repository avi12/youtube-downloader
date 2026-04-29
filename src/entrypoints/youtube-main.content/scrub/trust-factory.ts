import { buildSyntheticTemplateFromPlayer } from "../../sabr-fetch-interceptor/template-builder";
import { forcePlayback, wait, waitForPlayerReady } from "./player";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { uint8ToBase64 } from "@/lib/utils/binary";

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

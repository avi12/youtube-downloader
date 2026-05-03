import { buildSyntheticTemplateFromPlayer } from "../../sabr-fetch-interceptor/template-builder";
import { forcePlayback, POLL_INTERVAL_MS, wait, waitForPlayerReady } from "./player";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { uint8ToBase64 } from "@/lib/utils/binary";

const FACTORY_FIRST_CALL_WAIT_MS = 15_000;

function emitTemplate(template: {
  url: string;
  body: Uint8Array;
  capturedAt: number;
}) {
  window.__ytdlSabrTemplate = template;
  void crossWorldMessenger.sendMessage(CrossWorldMessage.SabrTemplateCaptured, {
    url: template.url,
    bodyBase64: uint8ToBase64(template.body),
    capturedAt: template.capturedAt
  });
}

export async function runTrustFactoryDrive() {
  console.log("[ytdl:trust-factory-tab] starting");

  const player = await waitForPlayerReady();
  if (!player) {
    console.warn("[ytdl:trust-factory-tab] player never ready");
    return;
  }

  const immediate = buildSyntheticTemplateFromPlayer();
  if (immediate) {
    console.log("[ytdl:trust-factory-tab] synthesized template immediately", {
      url: immediate.url,
      bodyLen: immediate.body.byteLength
    });
    emitTemplate(immediate);
    return;
  }

  console.log("[ytdl:trust-factory-tab] synthesis failed, forcing playback");
  void forcePlayback(player);

  const deadline = Date.now() + FACTORY_FIRST_CALL_WAIT_MS;
  while (Date.now() < deadline) {
    await wait(POLL_INTERVAL_MS);
    const polled = buildSyntheticTemplateFromPlayer();
    if (polled) {
      console.log("[ytdl:trust-factory-tab] synthesized template after forcePlayback", {
        url: polled.url,
        bodyLen: polled.body.byteLength
      });
      emitTemplate(polled);
      return;
    }
  }

  console.warn("[ytdl:trust-factory-tab] template never available after forcePlayback");
}

import { buildSyntheticTemplateFromPlayer } from "../../sabr-fetch-interceptor/template-builder";
import {
  forcePlayback,
  POLL_INTERVAL_MS,
  wait,
  waitForPlayerElement,
  waitForPlayerReady
} from "./player";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { IframeHostMessageType } from "@/lib/messaging/iframe-host-postmessage";
import { uint8ToBase64 } from "@/lib/utils/binary";
import { ScrubUrlParam } from "@/lib/youtube/youtube-url";

const FACTORY_FIRST_CALL_WAIT_MS = 15_000;
const factoryParams = new URLSearchParams(location.search);
const factoryId = factoryParams.get(ScrubUrlParam.FactoryId) ?? "";
const factoryVideoId = factoryParams.get("v") ?? "";

function emitTemplate(template: {
  url: string;
  body: Uint8Array;
  capturedAt: number;
}) {
  window.__ytdlSabrTemplate = template;
  const bodyBase64 = uint8ToBase64(template.body);
  void crossWorldMessenger.sendMessage(CrossWorldMessage.SabrTemplateCaptured, {
    url: template.url,
    bodyBase64,
    capturedAt: template.capturedAt
  });

  // Firefox doesn't inject isolated-world scripts into background-page iframes,
  // so crossWorldMessenger never reaches the isolated world there. Send via
  // parent.postMessage so iframe-host-receiver.ts can forward to the background.
  if (self !== top && factoryId) {
    parent.postMessage({
      type: IframeHostMessageType.TemplateReady,
      factoryId,
      videoId: factoryVideoId,
      url: template.url,
      bodyBase64,
      capturedAt: template.capturedAt
    }, "*");
  }
}

export async function runTrustFactoryDrive() {
  console.log("[ytdl:trust-factory-tab] starting");

  const player = await waitForPlayerElement();
  if (!player) {
    console.warn("[ytdl:trust-factory-tab] player element never appeared");
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
  void waitForPlayerReady().then(readyPlayer => {
    if (readyPlayer) {
      console.log("[ytdl:trust-factory-tab] player became fully ready");
    }
  });

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

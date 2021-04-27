import { getElementByObserver } from "./yt-downloader-utils";
import { getQuality } from "./yt-downloader-retrieve-player-metadata";
import { getIsVideoDownloadable } from "./yt-downloader-verify-downloadablility";
import {gSelButtonDownload, makeUI} from "./yt-downloader-content-script-ui";

export const gObserverOptions = { childList: true, subtree: true };
const gIdScript = "yt-downloader-script-to-inject";

export async function getScript(scriptName: string): Promise<string> {
  const port = chrome.runtime.connect({ name: "retrieve-script" });
  port.postMessage(scriptName);
  return new Promise(resolve => port.onMessage.addListener(resolve));
}

function injectScript(content: string) {
  const elScript = document.createElement("script");
  elScript.textContent = content;
  elScript.id = gIdScript;
  document.head.append(elScript);
}

function storeCurrentQuality() {
  const elDownloader = document.querySelector(`[${gSelButtonDownload}]`);
  elDownloader.setAttribute("data-yt-downloader-current-quality", getQuality());
}

getElementByObserver("title").then(elTitle => {
  new MutationObserver(() => {
    const elVideo = document.querySelector("video");
    elVideo.removeEventListener("canplay", storeCurrentQuality);
    elVideo.addEventListener("canplay", storeCurrentQuality);
  }).observe(elTitle, gObserverOptions);
});

let gScriptToInject;
new MutationObserver(async (_, observer) => {
  if (!gScriptToInject) {
    gScriptToInject = await getScript("yt-downloader-script-to-inject");
  }
  injectScript(gScriptToInject);

  if (!getIsVideoDownloadable(location.href)) {
    return;
  }

  const elButtonBeforeRating = document.querySelector(
    "#top-level-buttons > ytd-button-renderer"
  );
  const elScriptInjected = document.getElementById(gIdScript);
  if (!elButtonBeforeRating || !elScriptInjected) {
    return;
  }

  makeUI();
  storeCurrentQuality();
  observer.disconnect();
}).observe(document.body, gObserverOptions);

import { patchMediaElementForIframe, patchVisibilityForScrubFrame } from "./sourcebuffer-capture/media-patches";
import {
  createCaptureState,
  patchAddSourceBuffer,
  patchAppendBuffer
} from "./sourcebuffer-capture/sourcebuffer-patches";
import { RUN_AT_DOCUMENT_START } from "@/lib/utils/dom";

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: browser.scripting.ExecutionWorld.MAIN,
  runAt: RUN_AT_DOCUMENT_START,
  allFrames: true,
  main() {
    if (self !== top && !location.search.includes("ytdl=1")) {
      return;
    }

    const isScrubFrame = location.search.includes("ytdlScrubMode=1");
    const isTopLevelScrubTab = self === top && isScrubFrame;
    if ((self !== top || isTopLevelScrubTab) && !isScrubFrame) {
      patchMediaElementForIframe();
    }

    if (isScrubFrame) {
      patchVisibilityForScrubFrame();
    }

    const sourceBufferMimeTypes = new WeakMap<SourceBuffer, string>();
    const captureState = createCaptureState(sourceBufferMimeTypes);

    window.__ytdlCapture = captureState;

    patchAddSourceBuffer(captureState, sourceBufferMimeTypes);
    patchAppendBuffer(captureState, sourceBufferMimeTypes, isScrubFrame);
  }
});

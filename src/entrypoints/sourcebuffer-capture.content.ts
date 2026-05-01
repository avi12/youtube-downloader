import { patchMediaElementForIframe, patchVisibilityForScrubFrame } from "./sourcebuffer-capture/media-patches";
import {
  createCaptureState,
  patchAddSourceBuffer,
  patchAppendBuffer
} from "./sourcebuffer-capture/sourcebuffer-patches";
import { ScrubUrlParam } from "@/lib/youtube/youtube-url";

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  runAt: "document_start",
  allFrames: true,
  main() {
    if (self !== top && !location.search.includes(`${ScrubUrlParam.Ytdl}=1`)) {
      return;
    }

    const isScrubFrame = location.search.includes(`${ScrubUrlParam.ScrubMode}=1`);
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

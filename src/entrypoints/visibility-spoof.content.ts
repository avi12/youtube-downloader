// YouTube's player pauses streaming in background tabs, unfocused tabs, and iframes;
// spoof visibility/focus/frame so it always streams.
import { RUN_AT_DOCUMENT_START } from "@/lib/utils/dom";

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: browser.scripting.ExecutionWorld.MAIN,
  runAt: RUN_AT_DOCUMENT_START,
  allFrames: true,
  main() {
    Object.defineProperty(document, "visibilityState", {
      get() {
        return "visible";
      },
      configurable: true
    });
    Object.defineProperty(document, "hidden", {
      get() {
        return false;
      },
      configurable: true
    });
    document.hasFocus = () => true;

    if (navigator.webdriver) {
      Object.defineProperty(navigator, "webdriver", {
        get() {
          return false;
        },
        configurable: true
      });
    }

    if (self !== top) {
      Object.defineProperty(window, "frameElement", {
        get() {
          return null;
        },
        configurable: true
      });
    }
  }
});

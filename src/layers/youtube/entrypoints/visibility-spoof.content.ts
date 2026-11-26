import { isDownloadFrame } from "@/lib/youtube/download-frame";

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  runAt: "document_start",
  allFrames: true,
  main() {
    // On a watch page, claiming a hidden tab is visible makes YouTube wait for frames that never come
    if (!isDownloadFrame()) {
      return;
    }

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
    Object.defineProperty(window, "frameElement", {
      get() {
        return null;
      },
      configurable: true
    });
  }
});

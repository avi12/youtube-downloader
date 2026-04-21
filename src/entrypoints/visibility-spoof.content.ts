// YouTube's player pauses streaming in background tabs, unfocused tabs, and iframes;
// spoof visibility/focus/frame so it always streams. Also hide navigator.webdriver
// on Firefox dev builds — BotGuard reads it when signing the PO token and YouTube's
// SABR server rejects tokens that were minted in an automation context.
export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  runAt: "document_start",
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

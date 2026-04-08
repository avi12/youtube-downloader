/**
 * Minimal content script that spoofs document.visibilityState in all frames.
 * Runs at document_start so YouTube's player thinks the page is visible,
 * enabling media streaming in hidden iframes and background tabs.
 *
 * This is a separate script from the main content scripts to avoid WXT
 * context conflicts when using allFrames: true.
 */

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
  }
});

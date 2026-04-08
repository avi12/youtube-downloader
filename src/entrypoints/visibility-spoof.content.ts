/**
 * Spoofs page visibility and iframe detection in all frames at document_start.
 * YouTube's player checks these to decide whether to stream media:
 * - visibilityState/hidden: pauses in background tabs
 * - hasFocus: pauses when tab loses focus
 * - frameElement/top: limits streaming in iframes
 *
 * Separate from main content scripts to avoid WXT context conflicts.
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
    document.hasFocus = () => true;

    // Make iframes appear as top-level pages to YouTube's player
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

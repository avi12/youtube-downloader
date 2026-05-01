import { Browser } from "#imports";

// Hide navigator.webdriver from YouTube's BotGuard. The dev-server launches
// Firefox with --marionette (needed for web-ext-run sideload + MCP), which
// flips Navigator::Webdriver() to true at the Gecko level via nsIMarionette.
// The `dom.webdriver.enabled` pref is a deprecated no-op in modern Firefox.
// Overriding the property at document_start in the MAIN world runs before
// YouTube's own scripts, so any subsequent read (including BotGuard's) sees
// the spoofed value and any [Constant, Cached] webidl cache seats on false.
export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: Browser.scripting.ExecutionWorld.MAIN,
  runAt: "document_start",
  allFrames: true,
  main() {
    Object.defineProperty(Navigator.prototype, "webdriver", {
      get() {
        return false;
      },
      configurable: true
    });
  }
});

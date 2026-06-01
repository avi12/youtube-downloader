const YTDL_IFRAME_QUERY_PARAM = "ytdl=1";

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  runAt: "document_start",
  allFrames: true,
  main() {
    const isYtdlIframe = self !== top && location.search.includes(YTDL_IFRAME_QUERY_PARAM);
    if (!isYtdlIframe) {
      return;
    }

    const originalPlay = HTMLVideoElement.prototype.play;
    HTMLVideoElement.prototype.play = function () {
      this.muted = true;
      this.volume = 0;
      return originalPlay.call(this);
    };
  }
});

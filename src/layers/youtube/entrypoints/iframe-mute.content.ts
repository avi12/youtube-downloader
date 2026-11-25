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

    // The player unmutes and restores volume on its own while it plays, so the setters refuse it
    const mediaPrototype = HTMLMediaElement.prototype;
    const mutedDescriptor = Object.getOwnPropertyDescriptor(mediaPrototype, "muted");
    const volumeDescriptor = Object.getOwnPropertyDescriptor(mediaPrototype, "volume");
    Object.defineProperty(mediaPrototype, "muted", {
      ...mutedDescriptor,
      set() {
        mutedDescriptor?.set?.call(this, true);
      }
    });
    Object.defineProperty(mediaPrototype, "volume", {
      ...volumeDescriptor,
      set() {
        volumeDescriptor?.set?.call(this, 0);
      }
    });

    const originalPlay = HTMLVideoElement.prototype.play;
    HTMLVideoElement.prototype.play = function () {
      this.muted = true;
      this.volume = 0;
      return originalPlay.call(this);
    };
  }
});

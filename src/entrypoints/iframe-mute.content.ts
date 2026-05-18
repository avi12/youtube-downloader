export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  runAt: "document_start",
  allFrames: true,
  main() {
    if (self === top || !/ytdl=1/.test(location.search)) {
      return;
    }

    const origPlay = HTMLVideoElement.prototype.play;
    HTMLVideoElement.prototype.play = function () {
      this.muted = true;
      this.volume = 0;
      return origPlay.call(this);
    };
  }
});

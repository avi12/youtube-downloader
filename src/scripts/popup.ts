import Options from "./components/Options.svelte";

async function init() {
  const {
    videoQueue: gVideoQueue,
    musicQueue: gMusicQueue,
    videoDetails: gVideoDetails,
    videoIds: gVideoIds,
    isFFmpegReady,
    statusProgress: gStatusProgress
  } = await new Promise(resolve =>
    chrome.storage.local.get(
      [
        "videoQueue",
        "musicQueue",
        "videoDetails",
        "videoIds",
        "isFFmpegReady",
        "statusProgress"
      ],
      resolve
    )
  );

  new Options({
    target: document.body,
    props: {
      gVideoQueue,
      gMusicQueue,
      gVideoDetails,
      gVideoIds,
      isFFmpegReady,
      gStatusProgress
    }
  });
}

init();

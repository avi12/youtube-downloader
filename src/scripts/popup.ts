import Options from "./components/Options.svelte";

async function init() {
  const {
    videoQueue: gVideoQueue,
    videoOnlyQueue: gVideoOnlyQueue,
    musicQueue: gMusicQueue,
    videoDetails: gVideoDetails,
    videoIds: gVideoIds,
    isFFmpegReady,
    statusProgress: gStatusProgress
  } = await new Promise(resolve =>
    chrome.storage.local.get(
      [
        "videoQueue",
        "videoOnlyQueue",
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
      gVideoOnlyQueue,
      gVideoDetails,
      gVideoIds,
      isFFmpegReady,
      gStatusProgress
    }
  });
}

init();

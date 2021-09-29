import Options from "./components/Options.svelte";

async function init() {
  const {
    musicList,
    videoQueue,
    videoOnlyList,
    videoDetails,
    isFFmpegReady,
    statusProgress
  } = await new Promise(resolve =>
    chrome.storage.local.get(
      [
        "musicList",
        "videoQueue",
        "videoOnlyList",
        "videoDetails",
        "isFFmpegReady",
        "statusProgress"
      ],
      resolve
    )
  );

  new Options({
    target: document.body,
    props: {
      musicList,
      videoQueue,
      videoOnlyList,
      videoDetails,
      isFFmpegReady,
      statusProgress
    }
  });
}

init();

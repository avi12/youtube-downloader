import Popup from "./views/Popup.svelte";
import { getStoredOptions } from "./utils";

async function init() {
  const { musicList, videoQueue, videoOnlyList, videoDetails, isFFmpegReady, statusProgress } =
    await new Promise(resolve =>
      chrome.storage.local.get(
        ["musicList", "videoQueue", "videoOnlyList", "videoDetails", "isFFmpegReady", "statusProgress"],
        resolve
      )
    );

  new Popup({
    target: document.body,
    props: {
      musicList,
      videoQueue,
      videoOnlyList,
      videoDetails,
      isFFmpegReady,
      statusProgress,
      options: await getStoredOptions()
    }
  });
}

init();

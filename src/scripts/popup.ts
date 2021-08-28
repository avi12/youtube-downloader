import Options from "./components/Options.svelte";
import type {
  StatusProgress,
  TabTracker,
  VideoDetails,
  VideoIds,
  VideoQueue
} from "./types";

async function init() {
  const {
    videoQueue: gVideoQueue,
    tabTracker: gTabTracker,
    videoDetails: gVideoDetails,
    videoIds: gVideoIds,
    isFFmpegReady,
    statusProgress
  }: {
    videoQueue: VideoQueue;
    tabTracker: TabTracker;
    videoDetails: VideoDetails;
    videoIds: VideoIds;
    isFFmpegReady: boolean;
    statusProgress: StatusProgress;
  } = await new Promise(resolve =>
    chrome.storage.local.get(
      [
        "videoQueue",
        "tabTracker",
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
      gTabTracker,
      gVideoDetails,
      gVideoIds,
      isFFmpegReady,
      statusProgress
    }
  });
}

init();

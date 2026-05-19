import App from "./App.svelte";
import { isFFmpegReadyItem } from "@/lib/storage/storage";
import {
  musicListItem,
  optionsItem,
  statusProgressItem,
  videoDetailsItem,
  videoOnlyListItem,
  videoQueueItem
} from "@/lib/storage/storage";
import { INITIAL_OPTIONS as defaultOptions } from "@/lib/youtube/video-helpers";
import { mount } from "svelte";

const [
  isFFmpegReady,
  videoQueue,
  musicList,
  videoOnlyList,
  videoDetails,
  statusProgress,
  options,
  activeTabs
] = await Promise.all([
  isFFmpegReadyItem.getValue(),
  videoQueueItem.getValue(),
  musicListItem.getValue(),
  videoOnlyListItem.getValue(),
  videoDetailsItem.getValue(),
  statusProgressItem.getValue(),
  optionsItem.getValue(),
  browser.tabs.query({
    active: true,
    currentWindow: true
  })
]);
const currentTabId = activeTabs[0]?.id;

const elApp = document.getElementById("app");
if (!elApp) {
  throw new Error("Missing #app element");
}

mount(App, {
  target: elApp,
  props: {
    initialIsFFmpegReady: isFFmpegReady,
    initialVideoQueue: videoQueue,
    initialMusicList: musicList,
    initialVideoOnlyList: videoOnlyList,
    initialVideoDetails: videoDetails,
    initialStatusProgress: statusProgress,
    initialCurrentTabId: currentTabId,
    initialOptions: {
      ...defaultOptions,
      ...options
    }
  }
});

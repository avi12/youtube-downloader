import App from "./App.svelte";
import {
  isFFmpegReadyItem,
  musicListItem,
  optionsItem,
  statusProgressItem,
  videoDetailsItem,
  videoOnlyListItem,
  videoQueueItem
} from "@/lib/storage/storage";
import { mount } from "svelte";

const [
  isFFmpegReady,
  videoQueue,
  musicList,
  videoOnlyList,
  videoDetails,
  statusProgress,
  options
] = await Promise.all([
  isFFmpegReadyItem.getValue(),
  videoQueueItem.getValue(),
  musicListItem.getValue(),
  videoOnlyListItem.getValue(),
  videoDetailsItem.getValue(),
  statusProgressItem.getValue(),
  optionsItem.getValue()
]);

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
    initialOptions: options
  }
});

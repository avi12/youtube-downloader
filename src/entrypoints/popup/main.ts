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

mount(App, {
  target: document.getElementById("app")!,
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

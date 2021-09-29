<script lang="ts">
  import type {
    VideoQueue,
    MusicList,
    VideoOnlyList,
    MovableList,
    StatusProgress,
    VideoDetails
  } from "../types";

  import { getLocalStorage, updateQueue } from "../utils";

  import { MaterialAppMin } from "svelte-materialify";
  import MediaList from "./MediaList.svelte";
  import MediaQueue from "./MediaQueue.svelte";

  export let isFFmpegReady: boolean;
  export let videoQueue: VideoQueue;
  export let musicList: MusicList;
  export let videoOnlyList: VideoOnlyList;
  export let videoDetails: VideoDetails;
  export let statusProgress: StatusProgress;

  let videosMovable: MovableList = videoQueue.map(videoId => ({
    id: videoId,
    title: videoDetails[videoId].filenameOutput
  }));

  async function getMovableList(videoQueue: VideoQueue): Promise<MovableList> {
    const videoDetails = (await getLocalStorage(
      "videoDetails"
    )) as VideoDetails;

    return videoQueue.map(videoId => ({
      id: videoId,
      title: videoDetails[videoId].filenameOutput
    }));
  }

  chrome.storage.onChanged.addListener(async changes => {
    if (changes.isFFmpegReady) {
      isFFmpegReady = changes.isFFmpegReady.newValue;
      return;
    }

    if (changes.videoQueue) {
      videosMovable = await getMovableList(changes.videoQueue.newValue);
      return;
    }

    if (changes.musicList) {
      musicList = changes.musicList.newValue;
      return;
    }

    if (changes.videoOnlyList) {
      videoOnlyList = changes.videoOnlyList.newValue;
      return;
    }

    if (changes.videoDetails) {
      videoDetails = changes.videoDetails.newValue;
      return;
    }

    if (changes.statusProgress) {
      statusProgress = changes.statusProgress.newValue;
    }
  });

  async function reorderVideos({ detail: videos }: { detail: VideoQueue }) {
    await updateQueue("video", videos);
  }

  function stopAllDownloads({
    detail: queue
  }: {
    detail: VideoQueue | MusicList | VideoOnlyList;
  }) {
    chrome.runtime.sendMessage({
      action: "cancel-download",
      videoIdsToCancel: queue
    });
  }
</script>

<MaterialAppMin>
  <h1 class="text-center text-h5">YouTube Downloader</h1>

  <MediaQueue
    {videosMovable}
    {statusProgress}
    {isFFmpegReady}
    on:remove-from-queue={stopAllDownloads}
    on:reorder-videos={reorderVideos}
  />

  <MediaList
    label="Music"
    list={musicList}
    {videoDetails}
    {statusProgress}
    on:remove-from-list={stopAllDownloads}
  />

  <MediaList
    label="Video-only"
    list={videoOnlyList}
    {videoDetails}
    {statusProgress}
    on:remove-from-list={stopAllDownloads}
  />
</MaterialAppMin>

<style>
  :global(body) {
    width: 500px;
    background-color: white;
    padding: 10px;
  }
</style>

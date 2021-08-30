<script lang="ts">
  import type {
    VideoQueue,
    MovableList,
    StatusProgress,
    VideoDetails
  } from "../types";

  export let isFFmpegReady;
  export let gVideoQueue: VideoQueue;
  export let gVideoDetails: VideoDetails;
  export let statusProgress: StatusProgress;

  import { dndzone } from "svelte-dnd-action";
  import { flip } from "svelte/animate";
  import { getStorage, updateVideoQueue } from "../utils";

  let videosMovable: MovableList = gVideoQueue.map(videoId => ({
    id: videoId,
    title: gVideoDetails[videoId].filenameOutput
  }));

  const flipDurationMs = 200;

  async function onSort(e) {
    videosMovable = e.detail.items;

    if (e.type === "finalize") {
      await updateVideoQueue(getVideoQueue(videosMovable));
    }
  }

  function getVideoQueue(videosMoveable: MovableList): VideoQueue {
    return videosMoveable.map(({ id }) => id);
  }

  async function getMovableList(videoQueue: VideoQueue): Promise<MovableList> {
    const videoDetails = (await getStorage(
      "local",
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

    if (changes.statusProgress) {
      statusProgress = changes.statusProgress.newValue;
    }
  });

  function removeFromQueue(videoId: string) {
    chrome.runtime.sendMessage({
      action: "cancel-download",
      videoIdsToCancel: [videoId]
    });
  }

  function stopAllDownloads() {
    chrome.runtime.sendMessage({
      action: "cancel-download",
      videoIdsToCancel: gVideoQueue
    });
  }
</script>

<h1 style="text-align: center;">YouTube Downloader</h1>
Video queue
{#if videosMovable.length > 0}
  (drag to rearrange)
  <section>
    <button on:click={stopAllDownloads}>Stop all {@html "&#x274C;"}</button>
  </section>
{:else}
  <section>(Currently empty)</section>
{/if}

<section
  on:consider={onSort}
  on:finalize={onSort}
  use:dndzone={{ items: videosMovable, flipDurationMs }}
>
  {#each videosMovable as video, i (video.id)}
    <div
      style="display: flex; align-items: center"
      animate:flip={{ duration: flipDurationMs }}
    >
      <span class="video--title">{video.title}</span>
      {#if i === 0}
        <span class="status-progress">
          {#if isFFmpegReady}
            {#if statusProgress.type === "video"}
              downloading video...
            {:else if statusProgress.type === "audio"}
              downloading audio...
            {:else if statusProgress.type === "ffmpeg"}
              stitching video & audio...
            {/if}
            {(statusProgress.progress * 100).toFixed(2)}%
          {:else}
            initializing FFmpeg...
          {/if}
        </span>
      {/if}
      <button class="cancel-download" on:click={() => removeFromQueue(video.id)}
        >{@html "&#x274C;"}</button
      >
    </div>
  {/each}
</section>

<style>
  :global(body) {
    width: 500px;
    background-color: white;
  }

  .status-progress {
    color: gray;
  }

  .video--title {
    display: inline-block;
    max-width: 300px;
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
    margin-right: 10px;
  }

  .cancel-download {
    margin-left: auto;
  }
</style>

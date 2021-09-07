<script lang="ts">
  import type {
    VideoQueue,
    MusicQueue,
    MovableList,
    StatusProgress,
    VideoDetails
  } from "../types";

  export let isFFmpegReady;
  export let gVideoQueue: VideoQueue;
  export let gMusicQueue: MusicQueue;
  export let gVideoDetails: VideoDetails;
  export let gStatusProgress: StatusProgress;

  import { dndzone } from "svelte-dnd-action";
  import { flip } from "svelte/animate";
  import { getLocalStorage, updateVideoQueue } from "../utils";

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

    if (changes.musicQueue) {
      gMusicQueue = changes.musicQueue.newValue;
      return;
    }

    if (changes.videoDetails) {
      gVideoDetails = changes.videoDetails.newValue;
      return;
    }

    if (changes.statusProgress) {
      gStatusProgress = changes.statusProgress.newValue;
    }
  });

  function removeFromQueue(videoId: string) {
    chrome.runtime.sendMessage({
      action: "cancel-download",
      videoIdsToCancel: [videoId]
    });
  }

  function stopAllDownloads(queue: VideoQueue | MusicQueue) {
    chrome.runtime.sendMessage({
      action: "cancel-download",
      videoIdsToCancel: queue
    });
  }

  function getProgress(progress: number): string {
    return (progress * 100).toFixed(2) + "%";
  }

  const symbolX = "&#x274C;";
</script>

<h1 style="text-align: center;">YouTube Downloader</h1>
Video queue
{#if videosMovable.length > 0}
  (drag to rearrange)
  <section>
    <button on:click={() => stopAllDownloads(gVideoQueue)}
      >Stop all {@html symbolX}</button
    >
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
    <div class="download-container" animate:flip={{ duration: flipDurationMs }}>
      <span class="video__title">{video.title}</span>
      {#if i === 0}
        <span class="status-progress">
          {#if isFFmpegReady}
            {#if gStatusProgress[video.id].type === "video"}
              downloading video...
            {:else if gStatusProgress[video.id].type === "audio"}
              downloading audio...
            {:else if gStatusProgress[video.id].type === "ffmpeg"}
              stitching video & audio...
            {/if}
            {getProgress(gStatusProgress[video.id].progress)}
          {:else}
            initializing FFmpeg...
          {/if}
        </span>
      {/if}
      <button class="cancel-download" on:click={() => removeFromQueue(video.id)}
        >{@html symbolX}</button
      >
    </div>
  {/each}
</section>

<br />
Music list:
{#if gMusicQueue.length > 0}
  <section>
    <button on:click={() => stopAllDownloads(gMusicQueue)}
      >Stop all {@html symbolX}</button
    >
  </section>
{:else}
  <section>(Currently empty)</section>
{/if}
{#each gMusicQueue as videoId}
  <section class="download-container">
    <span class="video__title">{gVideoDetails[videoId].filenameOutput}</span>
    <div class="status-progress">
      {#if gStatusProgress[videoId]}
        downloading... {getProgress(gStatusProgress[videoId].progress)}
      {/if}
    </div>
    <button class="cancel-download" on:click={() => removeFromQueue(videoId)}
      >{@html symbolX}</button
    >
  </section>
{/each}

<style>
  :global(body) {
    width: 500px;
    background-color: white;
  }

  .status-progress {
    color: gray;
  }

  .video__title {
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

  .download-container {
    display: flex;
    align-items: center;
  }
</style>

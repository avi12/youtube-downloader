<script lang="ts">
  import { List, ListItem, Button, Icon } from "svelte-materialify";
  import { mdiClose, mdiCancel } from "@mdi/js";
  import { createEventDispatcher } from "svelte";
  import { dndzone } from "svelte-dnd-action";

  import type {
    VideoQueue,
    MovableList,
    StatusProgress
  } from "../types";
  import { getProgress } from "./component-utils";

  export let videosMovable: MovableList;
  export let statusProgress: StatusProgress;
  export let isFFmpegReady: boolean;

  const dispatch = createEventDispatcher();

  const flipDurationMs = 200;
  function onSort(e) {
    videosMovable = e.detail.items;
    

    if (e.type === "finalize") {
      dispatch("reorder-videos", getVideoQueue(videosMovable));
    }
  }

  function stopDownloads(ids: string[]) {
    dispatch("remove-from-queue", ids);
  }

  function getVideoQueue(videosMoveable: MovableList): VideoQueue {
    return videosMoveable.map(({ id }) => id);
  }
</script>

<section class="text-body-1">
  Video queue
  {#if videosMovable.length > 0}
    (drag to reorder)
    <section>
      <Button on:click={() => stopDownloads(getVideoQueue(videosMovable))}>
        <Icon path={mdiCancel} class="mr-3" /> Stop all
      </Button>
    </section>
  {:else}
    <section>(Currently empty)</section>
  {/if}
</section>

<List>
  <section
    on:consider={onSort}
    on:finalize={onSort}
    use:dndzone={{ items: videosMovable, flipDurationMs }}
  >
    {#each videosMovable as video, i (video.id)}
      <div>
        <ListItem>
          {video.title}

          <span slot="subtitle">
            {#if i === 0}
              {#if isFFmpegReady}
                {#if statusProgress[video.id]?.progressType === "video"}
                  downloading video...
                {:else if statusProgress[video.id]?.progressType === "audio"}
                  downloading audio...
                {:else if statusProgress[video.id]?.progressType === "ffmpeg"}
                  stitching video & audio...
                {/if}
                {getProgress(statusProgress[video.id]?.progress)}
              {:else}
                initializing FFmpeg...
              {/if}
            {/if}
          </span>

          <span slot="append">
            <Button on:click={() => stopDownloads([video.id])}>
              <Icon path={mdiClose} />
            </Button>
          </span>
        </ListItem>
      </div>
    {/each}
  </section>
</List>

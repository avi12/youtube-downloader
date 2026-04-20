<script lang="ts">
  import { downloadProgressStore } from "@/lib/ui/synced-stores.svelte";
  import { calculateWeightedProgress } from "@/lib/youtube/video-helpers";

  const { videoId }: { videoId: string } = $props();

  const downloadState = $derived(downloadProgressStore.get(videoId));
  const isDownloading = $derived(downloadState?.isDownloading ?? false);
  const isDone = $derived(downloadState?.isDone ?? false);

  let isLocallyDone = $state(false);

  $effect(() => {
    if (downloadState?.isDone) {
      isLocallyDone = true;
    } else if (!downloadState?.isDownloading) {
      isLocallyDone = false;
    }
  });

  const isVisible = $derived(isDownloading || isDone || isLocallyDone);
  const isIndeterminate = $derived(!isDone && !isLocallyDone && isDownloading && (downloadState?.progress ?? 0) === 0);

  const fillPercent = $derived(
    isDone || isLocallyDone
      ? 100
      : Math.round(
        calculateWeightedProgress({
          isDownloading,
          progress: downloadState?.progress ?? 0,
          progressType: downloadState?.progressType ?? ""
        })
      )
  );
</script>

{#if isVisible}
  <div
    class="ytdl-thumb-track"
    class:ytdl-thumb-track--done={isDone || isLocallyDone}
  >
    <tp-yt-paper-progress
      class="ytdl-thumb-bar"
      indeterminate={isIndeterminate || undefined}
      value={fillPercent}
    ></tp-yt-paper-progress>
    {#if isDownloading && !isIndeterminate}
      <div style:--ytdl-fill-pct="{fillPercent}%" class="ytdl-thumb-glare-clip">
        <div class="ytdl-thumb-glare"></div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .ytdl-thumb-track {
    --paper-progress-active-color: var(--yt-spec-brand-link-text, #3ea6ff);
    --paper-progress-container-color: rgb(255 255 255 / 30%);

    position: relative;
    inline-size: 100%;
  }

  .ytdl-thumb-track--done {
    animation: ytdl-thumb-fade 400ms ease 1500ms forwards;
  }

  @keyframes ytdl-thumb-fade {
    to{ opacity: 0%; }
  }

  .ytdl-thumb-bar {
    inline-size: 100%;
  }

  .ytdl-thumb-glare-clip {
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    inline-size: 100%;
    clip-path: inset(0 calc(100% - var(--ytdl-fill-pct, 0%)) 0 0);
    pointer-events: none;
  }

  .ytdl-thumb-glare {
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    inline-size: 40%;
    background: linear-gradient(90deg, transparent, rgb(255 255 255 / 40%), transparent);
    animation: ytdl-thumb-glare-anim 1800ms ease-in-out infinite;
  }

  @keyframes ytdl-thumb-glare-anim {
    0%{ translate: -100% 0; }
    100%{ translate: 250% 0; }
  }
</style>

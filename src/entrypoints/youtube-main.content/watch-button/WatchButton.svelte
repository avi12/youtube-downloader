<script lang="ts">
  import { createWatchButtonState } from "./WatchButton.state.svelte";
  import DownloadProgressRing from "@/components/download-button/DownloadProgressRing.svelte";
  import type { TpYtIronDropdownElement, VideoData } from "@/types";

  const {
    videoData,
    elDropdown,
    scopingClasses = []
  }: {
    videoData: VideoData;
    elDropdown: TpYtIronDropdownElement;
    scopingClasses?: string[];
  } = $props();

  const state = createWatchButtonState({
    get videoData() {
      return videoData;
    },
    get elDropdown() {
      return elDropdown;
    }
  });
</script>

<div
  bind:this={state.elGroup}
  class="ytdl-watch-group"
  data-ytdl-download-group="true"
  data-ytdl-download-state={state.downloadState}
  onclick={state.handleClick}
  role="none"
>
  <yt-button-view-model
    bind:this={state.elDownloadButton}
    class={[...scopingClasses, "ytdl-download-button"].join(" ")}
  ></yt-button-view-model>
  <yt-button-view-model
    bind:this={state.elChevronButton}
    class={[...scopingClasses, "ytdl-chevron-button"].join(" ")}
  ></yt-button-view-model>
  <div class="ytdl-watch-ring-slot" class:is-visible={state.isProgressRingVisible}>
    <DownloadProgressRing
      isError={state.isError}
      isIndeterminate={state.isIndeterminate}
      progress={state.effectiveProgress}
    />
  </div>
</div>

<script lang="ts">
  import type { WatchButtonLayout } from "./watch-button-types";
  import { createWatchButtonState } from "./WatchButton.state.svelte";
  import type { TpYtIronDropdownElement, VideoData } from "@/types";
  import DownloadProgressRing from "#youtube/components/download-button/DownloadProgressRing.svelte";

  const {
    videoData,
    elDropdown,
    scopingClasses = [],
    layout
  }: {
    videoData: VideoData;
    elDropdown: TpYtIronDropdownElement;
    scopingClasses?: string[];
    layout: WatchButtonLayout;
  } = $props();

  const state = createWatchButtonState({
    get videoData() {
      return videoData;
    },
    get elDropdown() {
      return elDropdown;
    },
    get layout() {
      return layout;
    }
  });
</script>

<div
  bind:this={state.elGroup}
  class="ytdl-watch-group"
  data-ytdl-download-group="true"
  data-ytdl-download-state={state.downloadState}
  data-ytdl-layout={layout}
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

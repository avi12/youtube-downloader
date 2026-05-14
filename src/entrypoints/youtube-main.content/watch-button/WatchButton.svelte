<script lang="ts">
  import { createWatchButtonState } from "./WatchButton.state.svelte";
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
  class={state.stateClass}
  data-ytdl-download-group="true"
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
  <svg
    class={["ytdl-watch-progress-ring", state.isIndeterminate ? "ytdl-watch-progress-ring--indeterminate" : "", state.isError ? "ytdl-watch-progress-ring--error" : ""].join(" ")}
    aria-hidden="true"
    viewBox="0 0 {state.PROGRESS_RING_SVG_SIZE} {state.PROGRESS_RING_SVG_SIZE}"
  >
    <circle
      class="ytdl-watch-progress-ring__track"
      cx={state.PROGRESS_RING_SVG_SIZE / 2}
      cy={state.PROGRESS_RING_SVG_SIZE / 2}
      r={state.PROGRESS_RING_RADIUS}
    />
    <circle
      class="ytdl-watch-progress-ring__indicator"
      cx={state.PROGRESS_RING_SVG_SIZE / 2}
      cy={state.PROGRESS_RING_SVG_SIZE / 2}
      r={state.PROGRESS_RING_RADIUS}
      stroke-dasharray={state.PROGRESS_RING_CIRCUMFERENCE}
      stroke-dashoffset={state.PROGRESS_RING_CIRCUMFERENCE * (1 - state.effectiveProgress)}
    />
  </svg>
</div>

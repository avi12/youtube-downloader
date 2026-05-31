<script lang="ts">
  import DownloadProgressRing from "@/components/download-button/DownloadProgressRing.svelte";
  import type { Snippet } from "svelte";

  interface Props {
    attachDownloadButton: (element: Element) => (() => void) | void;
    attachChevronButton: (element: Element) => (() => void) | void;
    attachButtonGroup?: (element: Element) => (() => void) | void;
    isProgressRingVisible: boolean;
    isIndeterminate: boolean;
    progress: number;
    isError: boolean;
    downloadState: string;
    ringAriaLabel?: string;
    isReady?: boolean;
    isLoadFailed?: boolean;
    hasCheckbox?: boolean;
    children?: Snippet;
  }

  const {
    attachDownloadButton,
    attachChevronButton,
    attachButtonGroup = () => {},
    isProgressRingVisible,
    isIndeterminate,
    progress,
    isError,
    downloadState,
    ringAriaLabel,
    isReady = true,
    isLoadFailed = false,
    hasCheckbox = false,
    children
  }: Props = $props();
</script>

<div class="ytdl-button-group" {@attach attachButtonGroup}>
  {#if isReady || isLoadFailed}
    <div
      class="ytdl-button-row"
      class:has-checkbox={hasCheckbox}
      data-ytdl-download-state={downloadState}
    >
      {@render children?.()}
      <div class="ytdl-download-btn-wrapper">
        <yt-button-view-model {@attach attachDownloadButton}></yt-button-view-model>
        <div class="ytdl-playlist-ring-slot" class:is-visible={isProgressRingVisible}>
          <DownloadProgressRing
            ariaLabel={ringAriaLabel}
            {isError}
            {isIndeterminate}
            {progress}
          />
        </div>
      </div>
      <yt-button-view-model {@attach attachChevronButton}></yt-button-view-model>
    </div>
  {:else}
    <div class="ytdl-spinner-container" aria-busy="true" aria-label="Loading video info">
      <tp-yt-paper-spinner-lite active></tp-yt-paper-spinner-lite>
    </div>
  {/if}
</div>

<style>
  .ytdl-button-group {
    display: inline-flex;
    flex-direction: column;
    margin-inline-start: 8px;
  }

  .ytdl-button-row {
    position: relative;
    display: flex;
    flex-shrink: 0;
    gap: 4px;
    align-items: center;

    &.has-checkbox {
      padding:
        calc(
          (var(--paper-checkbox-ink-size, 48px) - var(--paper-checkbox-size, 18px)) / 2
        );
    }
  }

  .ytdl-download-btn-wrapper {
    position: relative;
    display: inline-flex;
  }

  .ytdl-playlist-ring-slot {
    position: absolute;
    inset: -8px;
    opacity: 0%;
    pointer-events: none;
    transition: opacity 120ms ease-out;

    &.is-visible {
      opacity: 100%;
    }
  }

  .ytdl-spinner-container {
    display: flex;
    align-items: center;
    height: 36px;
    padding: 0 8px;
  }
</style>

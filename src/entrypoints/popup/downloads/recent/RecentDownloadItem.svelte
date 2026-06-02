<script lang="ts">
  import changeFormatIcon from "../../icons/change-format.svg?raw";
  import closeIcon from "../../icons/close.svg?raw";
  import folderIcon from "../../icons/folder.svg?raw";
  import openInNewIcon from "../../icons/open-in-new.svg?raw";
  import type { RecentDownloadEntry } from "@/types";
  import { browser } from "#imports";

  interface Props {
    entry: RecentDownloadEntry;
    now: number;
    showOpenInNew?: boolean;
    isFormatDialogOpen?: boolean;
    onShowInFolder: () => void;
    onChangeFormat: () => void;
    onRemove: () => void;
  }

  const {
    entry, now, showOpenInNew = true, isFormatDialogOpen = false,
    onShowInFolder, onChangeFormat, onRemove
  }: Props = $props();

  const anchorName = $derived(`--cf-${entry.id.replace(/[^a-zA-Z0-9-]/g, "")}`);

  const YT_THUMBNAIL_HOST = "https://i.ytimg.com/vi";
  // Prefer the standard YouTube video thumbnail. entry.thumbnailUrl may be
  // the square YouTube Music cover art that's meant for ID3 embedding in
  // the audio file — not for display here.
  const displayThumbnailUrl = $derived(
    entry.videoId ? `${YT_THUMBNAIL_HOST}/${entry.videoId}/mqdefault.jpg` : entry.thumbnailUrl
  );

  const isZip = $derived(entry.container === "zip");
  const openInNewTabLabel = $derived(isZip ? "Open playlist in new tab" : "Open video in new tab");

  function openInNewTab(): void {
    const url = isZip
      ? `https://www.youtube.com/playlist?list=${entry.videoId}`
      : `https://www.youtube.com/watch?v=${entry.videoId}`;
    void browser.tabs.create({ url });
  }

  const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const NF_BYTES = new Intl.NumberFormat(undefined, {
    style: "unit",
    unit: "byte",
    unitDisplay: "narrow",
    maximumFractionDigits: 0
  });
  const NF_KB = new Intl.NumberFormat(undefined, {
    style: "unit",
    unit: "kilobyte",
    unitDisplay: "narrow",
    maximumFractionDigits: 0
  });
  const NF_MB = new Intl.NumberFormat(undefined, {
    style: "unit",
    unit: "megabyte",
    unitDisplay: "narrow",
    maximumFractionDigits: 1
  });
  const NF_GB = new Intl.NumberFormat(undefined, {
    style: "unit",
    unit: "gigabyte",
    unitDisplay: "narrow",
    maximumFractionDigits: 2
  });
  const BYTES_PER_KB = 1024;
  const BYTES_PER_MB = 1024 * 1024;
  const BYTES_PER_GB = 1024 * 1024 * 1024;

  const AGE_THRESHOLDS: [number, Intl.RelativeTimeFormatUnit, number][] = [
    [60, "second", 1],
    [3600, "minute", 60],
    [Infinity, "hour", 3600]
  ];

  const relativeAgeLabel = $derived(formatRelativeAge(now - entry.completedAt));
  const sizeLabel = $derived(formatBytes(entry.size));

  function formatRelativeAge(deltaMs: number): string {
    const totalSeconds = Math.floor(deltaMs / 1000);
    const [, unit, divisor] = AGE_THRESHOLDS.find(([threshold]) => totalSeconds < threshold)!;
    return RTF.format(-Math.floor(totalSeconds / divisor), unit);
  }

  function formatBytes(bytes: number): string {
    if (bytes < BYTES_PER_KB) {
      return NF_BYTES.format(bytes);
    }

    if (bytes < BYTES_PER_MB) {
      return NF_KB.format(bytes / BYTES_PER_KB);
    }

    if (bytes < BYTES_PER_GB) {
      return NF_MB.format(bytes / BYTES_PER_MB);
    }

    return NF_GB.format(bytes / BYTES_PER_GB);
  }
</script>

<article class="recent-item" class:recent-item--active={isFormatDialogOpen}>
  <div class="recent-top">
    {#if displayThumbnailUrl}
      <img
        class="recent-thumb"
        alt=""
        height="67"
        src={displayThumbnailUrl}
        width="120"
      />
    {:else}
      <div class="recent-thumb recent-thumb-placeholder" aria-hidden="true">
        {#if entry.container}
          <span class="recent-thumb-container">{entry.container.toUpperCase()}</span>
        {/if}
      </div>
    {/if}

    <div class="recent-titleblock">
      <span class="recent-title">{entry.title}</span>
      {#if entry.channel}
        <span class="recent-channel">{entry.channel}</span>
      {/if}
    </div>
  </div>

  <div class="recent-bottom">
    <div class="recent-info">
      {#if entry.quality}
        <span class="recent-chip">{entry.quality}</span>
      {/if}
      <span class="recent-time">{sizeLabel} · {relativeAgeLabel}</span>
    </div>

    <div class="recent-actions">
      <button
        class="recent-action-btn"
        aria-label="Show in folder"
        data-tooltip="Show in folder"
        data-tooltip-align="end"
        onclick={onShowInFolder}
        type="button"
      >
        {@html folderIcon}
      </button>
      {#if showOpenInNew}
        <button
          class="recent-action-btn"
          aria-label={openInNewTabLabel}
          data-tooltip={openInNewTabLabel}
          data-tooltip-align="end"
          onclick={openInNewTab}
          type="button"
        >
          {@html openInNewIcon}
        </button>
      {/if}
      <button
        style:anchor-name={anchorName}
        class="recent-action-btn"
        aria-label="Change format"
        data-cf-trigger
        data-tooltip="Change format"
        data-tooltip-align="end"
        onclick={onChangeFormat}
        type="button"
      >
        {@html changeFormatIcon}
      </button>
      <button
        class="recent-action-btn"
        aria-label="Remove from history"
        data-tooltip="Remove from history"
        data-tooltip-align="end"
        onclick={onRemove}
        type="button"
      >
        {@html closeIcon}
      </button>
    </div>
  </div>
</article>

<style>
  .recent-item {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border-radius: 20px;
    background: var(--surface);
    transition: background-color 200ms;

    &:hover,
    &.recent-item--active {
      background: var(--surface-high);
    }
  }

  .recent-top {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }

  .recent-thumb {
    flex-shrink: 0;
    object-fit: cover;
    width: 120px;
    height: 67px;
    border-radius: 12px;
    background: var(--surface-high);
  }

  .recent-thumb-placeholder {
    display: flex;
    justify-content: center;
    align-items: center;
    background: linear-gradient(135deg, var(--surface-high), var(--border));
  }

  .recent-thumb-container {
    color: var(--fg-muted);
    font-weight: 700;
    font-size: 0.625rem;
    letter-spacing: 0.04em;
  }

  .recent-titleblock {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .recent-title {
    display: -webkit-box;
    overflow: hidden;
    font-weight: 500;
    font-size: 0.8125rem;
    line-height: 1.4;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .recent-channel {
    overflow: hidden;
    color: var(--fg-muted);
    font-size: 0.71875rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .recent-bottom {
    display: flex;
    gap: 8px;
    justify-content: space-between;
    align-items: center;
  }

  .recent-info {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    align-items: center;
    min-width: 0;
  }

  .recent-chip {
    display: inline-flex;
    align-items: center;
    height: 24px;
    padding: 0 9px;
    border-radius: 8px;
    background: var(--accent-container);
    color: var(--fg);
    font-weight: 600;
    font-size: 0.71875rem;
    white-space: nowrap;
  }

  .recent-time {
    overflow: hidden;
    color: var(--fg-muted);
    font-size: 0.6875rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .recent-actions {
    display: flex;
    flex-shrink: 0;
    gap: 2px;
  }

  .recent-action-btn {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 34px;
    height: 34px;
    padding: 0;
    border: none;
    border-radius: 17px;
    background: transparent;
    color: var(--fg-muted);
    cursor: pointer;
    transition: background-color 150ms, color 150ms;

    &:hover {
      background: var(--accent-hover);
      color: var(--fg);
    }

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    :global(svg) {
      width: 18px;
      height: 18px;
    }
  }
</style>

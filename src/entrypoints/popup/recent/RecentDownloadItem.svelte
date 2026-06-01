<script lang="ts">
  import type { RecentDownloadEntry } from "@/types";
  import { browser } from "#imports";

  interface Props {
    entry: RecentDownloadEntry;
    now: number;
    onShowInFolder: () => void;
    onChangeFormat: () => void;
    onRemove: () => void;
  }

  const { entry, now, onShowInFolder, onChangeFormat, onRemove }: Props = $props();

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

<article class="recent-item">
  <div class="recent-top">
    {#if entry.thumbnailUrl}
      <img
        class="recent-thumb"
        alt=""
        height="40"
        src={entry.thumbnailUrl}
        width="72"
      />
    {:else}
      <div class="recent-thumb recent-thumb-placeholder" aria-hidden="true">
        {#if entry.container}
          <span class="recent-thumb-container">{entry.container.toUpperCase()}</span>
        {/if}
      </div>
    {/if}

    <span class="recent-title">{entry.title}</span>
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
        <svg aria-hidden="true" fill="currentColor" height="18" viewBox="0 -960 960 960" width="18" xmlns="http://www.w3.org/2000/svg">
          <path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80h640v-400H447l-80-80H160v480Zm0 0v-480 480Z" />
        </svg>
      </button>
      <button
        class="recent-action-btn"
        aria-label={openInNewTabLabel}
        data-tooltip={openInNewTabLabel}
        data-tooltip-align="end"
        onclick={openInNewTab}
        type="button"
      >
        <svg aria-hidden="true" fill="currentColor" height="18" viewBox="0 -960 960 960" width="18" xmlns="http://www.w3.org/2000/svg">
          <path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h560v-280h80v280q0 33-23.5 56.5T760-120H200Zm188-212-56-56 372-372H560v-80h280v280h-80v-144L388-332Z" />
        </svg>
      </button>
      <button
        class="recent-action-btn"
        aria-label="Change format"
        data-tooltip="Change format"
        data-tooltip-align="end"
        onclick={onChangeFormat}
        type="button"
      >
        <svg aria-hidden="true" fill="currentColor" height="18" viewBox="0 -960 960 960" width="18" xmlns="http://www.w3.org/2000/svg">
          <path d="M280-120q-100 0-170-70T40-360q0-92 56-162t144-87l-40-41 56-56 160 160-160 160-56-57 54-54q-56 10-95 52t-39 85q0 66 47 113t113 47q66 0 113-47t47-113v-40h80v40q0 100-70 170T280-120Zm200-280L320-560l160-160 56 57-54 54q57 9 96.5 51.5T619-500h-81q-8-35-35.5-57.5T440-580l40 41-56 55Zm280-40q0-66-47-113t-113-47v-80q100 0 170 70t70 170h-80Z" />
        </svg>
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

    &:hover {
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
    width: 72px;
    height: 40px;
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
  }
</style>

<script lang="ts">
  import openInNewIcon from "../icons/open-in-new.svg?raw";
  import RecentDownloadMenu from "./RecentDownloadMenu.svelte";
  import type { RecentDownloadEntry } from "@/types";
  import { browser } from "#imports";

  interface Props {
    entry: RecentDownloadEntry;
    now: number;
    showOpenInNew?: boolean;
    onShowInFolder: () => void;
    onChangeFormat: () => void;
    onRemove: () => void;
  }

  const {
    entry, now, showOpenInNew = false,
    onShowInFolder, onChangeFormat, onRemove
  }: Props = $props();

  const isZip = $derived(entry.container === "zip");
  const openInNewTabLabel = $derived(isZip ? "Open playlist in new tab" : "Open video in new tab");

  function openInNewTab(): void {
    const url = isZip
      ? `https://www.youtube.com/playlist?list=${entry.videoId}`
      : `https://www.youtube.com/watch?v=${entry.videoId}`;
    void browser.tabs.create({ url });
  }

  let isMenuOpen = $state(false);

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

  function handleFilenameKeydown(e: KeyboardEvent): void {
    const isActivationKey = e.key !== "Enter" && e.key !== " ";
    if (isActivationKey) {
      return;
    }

    e.preventDefault();
    onShowInFolder();
  }

  function formatRelativeAge(deltaMs: number): string {
    const totalSeconds = Math.floor(deltaMs / 1000);
    const [, unit, divisor] = AGE_THRESHOLDS.find(([threshold]) => totalSeconds < threshold)!;
    return RTF.format(-Math.floor(totalSeconds / divisor), unit);
  }

  function formatBytes(bytes: number): string {
    const isLessThanKb = bytes < BYTES_PER_KB;
    if (isLessThanKb) {
      return NF_BYTES.format(bytes);
    }

    const isLessThanMb = bytes < BYTES_PER_MB;
    if (isLessThanMb) {
      return NF_KB.format(bytes / BYTES_PER_KB);
    }

    const isLessThanGb = bytes < BYTES_PER_GB;
    if (isLessThanGb) {
      return NF_MB.format(bytes / BYTES_PER_MB);
    }

    return NF_GB.format(bytes / BYTES_PER_GB);
  }
</script>

<article class="recent-item" class:menu-open={isMenuOpen}>
  {#if entry.thumbnailUrl}
    <img
      class="recent-thumb"
      alt=""
      height="48"
      src={entry.thumbnailUrl}
      width="48"
    />
  {:else}
    <div class="recent-thumb recent-thumb-placeholder" aria-hidden="true">
      {#if entry.container}
        <span class="recent-thumb-container">{entry.container.toUpperCase()}</span>
      {/if}
    </div>
  {/if}

  <div class="recent-body">
    <button
      class="recent-filename"
      data-tooltip={entry.filename}
      dir="auto"
      onclick={onShowInFolder}
      onkeydown={handleFilenameKeydown}
      type="button"
    >
      <span class="recent-filename-text">{entry.title}</span>
    </button>
    {#if entry.channel}
      <p class="recent-meta recent-channel" dir="auto">{entry.channel}</p>
    {/if}
    <p class="recent-meta">
      {#if entry.quality}
        {entry.quality} ·
      {/if}{sizeLabel} · {relativeAgeLabel}
    </p>
  </div>

  {#if showOpenInNew}
    <button
      class="recent-open-in-new"
      aria-label={openInNewTabLabel}
      data-tooltip={openInNewTabLabel}
      onclick={openInNewTab}
      type="button"
    >
      {@html openInNewIcon}
    </button>
  {/if}

  <RecentDownloadMenu
    entryId={entry.id}
    {isZip}
    {onChangeFormat}
    onMenuOpenChange={value => (isMenuOpen = value)}
    {onRemove}
    {onShowInFolder}
  />
</article>

<style>
  .recent-item {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--surface);
    transition: background-color 200ms;

    &:hover,
    &.menu-open {
      background: var(--surface-high);
    }
  }

  .recent-thumb {
    flex-shrink: 0;
    object-fit: cover;
    width: 48px;
    height: 48px;
    border-radius: 8px;
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

  .recent-body {
    flex: 1;
    min-width: 0;
  }

  .recent-filename {
    display: block;
    width: 100%;
    padding: 0;
    border: none;
    background: none;
    color: var(--fg);
    font-family: inherit;
    font-weight: 500;
    font-size: 0.8125rem;
    text-align: left;
    cursor: pointer;

    &:focus-visible {
      border-radius: 4px;
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
  }

  .recent-filename-text {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    .recent-filename:hover &,
    .recent-filename:focus-visible & {
      text-decoration: underline;
    }
  }

  .recent-meta {
    overflow: hidden;
    margin-top: 2px;
    color: var(--fg-muted);
    font-size: 0.6875rem;
    text-overflow: ellipsis;
    white-space: nowrap;

    &.recent-channel {
      margin-top: 0;
    }
  }

  .recent-open-in-new {
    display: flex;
    flex-shrink: 0;
    justify-content: center;
    align-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--fg-muted);
    cursor: pointer;
    transition: background-color 150ms;

    &:hover {
      background: var(--surface-high);
    }

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
  }
</style>

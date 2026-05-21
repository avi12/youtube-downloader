<script lang="ts">
  import RecentDownloadMenu from "./RecentDownloadMenu.svelte";
  import type { RecentDownloadEntry } from "@/types";

  interface Props {
    entry: RecentDownloadEntry;
    now: number;
    onShowInFolder: () => void;
    onChangeFormat: () => void;
    onRemove: () => void;
  }

  const { entry, now, onShowInFolder, onChangeFormat, onRemove }: Props = $props();

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
    <p class="recent-meta">{sizeLabel} · {relativeAgeLabel}</p>
  </div>

  <RecentDownloadMenu
    entryId={entry.id}
    isZip={entry.container === "zip"}
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
    position: relative;
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

    &::after {
      content: attr(data-tooltip);
      position: absolute;
      bottom: calc(100% + 4px);
      left: 0;
      z-index: 10;
      max-width: 280px;
      padding: 4px 8px;
      border-radius: 6px;
      background: var(--fg);
      color: var(--bg);
      font-weight: 400;
      font-size: 0.6875rem;
      word-break: break-all;
      opacity: 0%;
      pointer-events: none;
      transition: opacity 150ms;
    }

    &:hover::after,
    &:focus-visible::after {
      opacity: 100%;
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
</style>

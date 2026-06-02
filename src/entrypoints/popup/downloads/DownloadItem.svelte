<script lang="ts">
  import closeIcon from "../icons/close.svg?raw";
  import openInNewIcon from "../icons/open-in-new.svg?raw";
  import playArrowIcon from "../icons/play-arrow.svg?raw";
  import WavyProgress from "../shared/WavyProgress.svelte";
  import { browser } from "#imports";

  interface Props {
    filename: string;
    progress: number | null;
    progressLabel: string;
    statusLabel?: string | null;
    quality?: string;
    videoId?: string;
    title?: string;
    channel?: string;
    lengthSeconds?: number;
    thumbnailUrl?: string;
    downloadedBytes?: number;
    totalBytes?: number;
    bytesPerSecond?: number;
    sourceUrl?: string;
    tabId?: number;
    showTabActions?: boolean;
    oncancel: () => void;
  }

  const {
    filename, progress, progressLabel, statusLabel, quality, videoId,
    title, channel, lengthSeconds, thumbnailUrl, downloadedBytes, totalBytes, bytesPerSecond,
    sourceUrl, tabId, showTabActions = false, oncancel
  }: Props = $props();

  const YT_THUMBNAIL_HOST = "https://i.ytimg.com/vi";
  const BYTES_PER_KB = 1024;
  const BYTES_PER_MB = 1024 * 1024;
  const BYTES_PER_GB = 1024 * 1024 * 1024;
  const SECONDS_PER_MINUTE = 60;
  const SECONDS_PER_HOUR = 3600;

  let isThumbnailBroken = $state(false);

  const ytThumbnail = $derived(videoId ? `${YT_THUMBNAIL_HOST}/${videoId}/mqdefault.jpg` : null);
  const resolvedThumbnail = $derived(thumbnailUrl ?? ytThumbnail);

  const displayTitle = $derived(title ?? stripExtension(filename));
  const container = $derived(deriveContainer(filename));
  const durationLabel = $derived(
    lengthSeconds !== undefined && lengthSeconds > 0 ? formatDuration(lengthSeconds) : null
  );

  const isProcessing = $derived(
    (progress !== null && progressLabel.includes("processed"))
    || statusLabel === "Processing…"
    || statusLabel === "Waiting for FFmpeg…"
  );
  const isQueued = $derived(progress === null && statusLabel === "Downloading");
  const hasByteReadout = $derived(
    !isProcessing
    && downloadedBytes !== undefined
    && downloadedBytes > 0
  );

  const NF_PERCENT = new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 0
  });
  const percentLabel = $derived(progress !== null ? NF_PERCENT.format(progress) : "");

  const canShowTabAction = $derived(showTabActions && Boolean(sourceUrl || videoId));
  const hasByline = $derived(Boolean(channel) || canShowTabAction);

  function stripExtension(name: string): string {
    const iDot = name.lastIndexOf(".");
    if (iDot <= 0) {
      return name;
    }

    return name.slice(0, iDot);
  }

  function deriveContainer(name: string): string {
    const iDot = name.lastIndexOf(".");
    if (iDot <= 0 || iDot === name.length - 1) {
      return "";
    }

    return name.slice(iDot + 1).toUpperCase();
  }

  function formatDuration(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
    const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
    const seconds = Math.floor(totalSeconds % SECONDS_PER_MINUTE);
    const minutesStr = String(minutes).padStart(hours > 0 ? 2 : 1, "0");
    const secondsStr = String(seconds).padStart(2, "0");
    if (hours > 0) {
      return `${hours}:${minutesStr}:${secondsStr}`;
    }

    return `${minutesStr}:${secondsStr}`;
  }

  function formatBytes(bytes: number, maximumFractionDigits: number): string {
    const formatter = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: maximumFractionDigits === 2 ? 2 : 0,
      maximumFractionDigits
    });
    if (bytes >= BYTES_PER_GB) {
      return `${formatter.format(bytes / BYTES_PER_GB)} GB`;
    }

    if (bytes >= BYTES_PER_MB) {
      return `${formatter.format(bytes / BYTES_PER_MB)} MB`;
    }

    if (bytes >= BYTES_PER_KB) {
      return `${formatter.format(bytes / BYTES_PER_KB)} KB`;
    }

    return `${bytes} B`;
  }

  const NF_SPEED_MB = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
  const NF_SPEED_INT = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0
  });

  function formatSpeed(bytesPerSec: number): string {
    if (bytesPerSec < 1) {
      return "";
    }

    if (bytesPerSec >= BYTES_PER_MB) {
      return `${NF_SPEED_MB.format(bytesPerSec / BYTES_PER_MB)} MB/s`;
    }

    if (bytesPerSec >= BYTES_PER_KB) {
      return `${NF_SPEED_INT.format(bytesPerSec / BYTES_PER_KB)} KB/s`;
    }

    return `${NF_SPEED_INT.format(bytesPerSec)} B/s`;
  }

  const byteReadoutParts = $derived.by(() => {
    const parts: string[] = [];
    if (downloadedBytes !== undefined && downloadedBytes > 0) {
      const downloadedStr = formatBytes(downloadedBytes, 0);
      const hasValidTotal = totalBytes !== undefined && totalBytes >= downloadedBytes;
      if (hasValidTotal) {
        parts.push(`${downloadedStr} / ${formatBytes(totalBytes, 2)}`);
      } else {
        parts.push(downloadedStr);
      }
    }

    if (bytesPerSecond !== undefined && bytesPerSecond > 0) {
      const speedStr = formatSpeed(bytesPerSecond);
      if (speedStr) {
        parts.push(speedStr);
      }
    }

    return parts;
  });

  async function focusSourceTab(): Promise<void> {
    if (tabId !== undefined && tabId >= 0) {
      try {
        const tab = await browser.tabs.get(tabId);
        await browser.tabs.update(tabId, { active: true });

        if (tab.windowId !== undefined) {
          await browser.windows.update(tab.windowId, { focused: true });
        }

        return;
      } catch {
      // tab is gone, fall through to opening a new one
      }
    }

    if (sourceUrl) {
      void browser.tabs.create({ url: sourceUrl });
    } else if (videoId) {
      void browser.tabs.create({ url: `https://www.youtube.com/watch?v=${videoId}` });
    }
  }
</script>

<article class="dl-card">
  <div class="dl-row">
    {#if canShowTabAction}
      <button
        class="dl-thumb-wrap dl-thumb-wrap-button"
        aria-label="Open {displayTitle} in source tab"
        onclick={focusSourceTab}
        type="button"
      >
        {#if resolvedThumbnail && !isThumbnailBroken}
          <img
            class="dl-thumb"
            alt=""
            height="67"
            onerror={() => (isThumbnailBroken = true)}
            src={resolvedThumbnail}
            width="120"
          />
        {:else}
          <div class="dl-thumb dl-thumb-placeholder" aria-hidden="true"></div>
        {/if}
        <span class="dl-thumb-play" aria-hidden="true">
          {@html playArrowIcon}
        </span>
        {#if durationLabel}
          <span class="dl-thumb-duration">{durationLabel}</span>
        {/if}
      </button>
    {:else}
      <div class="dl-thumb-wrap">
        {#if resolvedThumbnail && !isThumbnailBroken}
          <img
            class="dl-thumb"
            alt=""
            height="67"
            onerror={() => (isThumbnailBroken = true)}
            src={resolvedThumbnail}
            width="120"
          />
        {:else}
          <div class="dl-thumb dl-thumb-placeholder" aria-hidden="true"></div>
        {/if}
        {#if durationLabel}
          <span class="dl-thumb-duration">{durationLabel}</span>
        {/if}
      </div>
    {/if}

    <div class="dl-info">
      {#if canShowTabAction}
        <button
          class="dl-title dl-title-button"
          onclick={focusSourceTab}
          type="button"
        >{displayTitle}</button>
      {:else}
        <span class="dl-title">{displayTitle}</span>
      {/if}
      {#if hasByline}
        <span class="dl-byline">
          {#if channel}
            <span class="dl-channel">{channel}</span>
          {/if}
          {#if channel && canShowTabAction}
            <span class="dl-byline-sep">·</span>
          {/if}
          {#if canShowTabAction}
            <button class="dl-watch-link" onclick={focusSourceTab} type="button">Watch tab</button>
          {/if}
        </span>
      {/if}
      <div class="dl-chips">
        {#if quality}
          <span class="dl-chip dl-chip-accent">{quality}</span>
        {/if}
        {#if container}
          <span class="dl-chip">{container}</span>
        {/if}
      </div>
    </div>

    <div class="dl-actions">
      {#if canShowTabAction}
        <button
          class="dl-action"
          aria-label="Open source tab"
          data-tooltip="Open source tab"
          data-tooltip-align="end"
          onclick={focusSourceTab}
          type="button"
        >
          {@html openInNewIcon}
        </button>
      {/if}
      <button
        class="dl-action dl-cancel"
        aria-label="Cancel download of {displayTitle}"
        data-tooltip="Cancel download"
        data-tooltip-align="end"
        onclick={oncancel}
        type="button"
      >
        {@html closeIcon}
      </button>
    </div>
  </div>

  {#if isProcessing}
    <div class="dl-prog-bar">
      <WavyProgress indeterminate />
    </div>
    <div class="dl-prog-line">
      <span class="state-pill state-processing">
        <span class="state-spinner" aria-hidden="true"></span>
        Processing
      </span>
      <span class="dl-prog-stat">Merging video, audio tracks &amp; captions</span>
    </div>
  {:else if isQueued}
    <div class="dl-prog-line">
      <span class="state-pill state-queued">Queued</span>
      <span class="dl-prog-stat">Waiting for a free slot</span>
    </div>
  {:else if progress !== null}
    <div class="dl-prog-bar">
      <WavyProgress value={progress * 100} />
    </div>
    <div class="dl-prog-line">
      <span class="dl-prog-pct">{percentLabel}</span>
      {#if hasByteReadout && byteReadoutParts.length > 0}
        <span class="dl-prog-stat">{byteReadoutParts.join(" · ")}</span>
      {:else}
        <span class="dl-prog-stat">{progressLabel}</span>
      {/if}
    </div>
  {/if}
</article>

<style>
  .dl-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border-radius: 20px;
    background: var(--surface);
  }

  .dl-row {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }

  .dl-thumb-wrap {
    position: relative;
    flex-shrink: 0;
    overflow: hidden;
    width: 120px;
    height: 67px;
    border-radius: 12px;
    background: var(--surface-high);
  }

  .dl-thumb-wrap-button {
    padding: 0;
    border: none;
    color: inherit;
    cursor: pointer;
    transition: opacity 150ms;

    &:hover,
    &:focus-visible {
      opacity: 90%;
    }

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
  }

  .dl-thumb {
    display: block;
    object-fit: cover;
    width: 120px;
    height: 67px;
  }

  .dl-thumb-placeholder {
    background: linear-gradient(135deg, var(--surface-high), var(--border));
  }

  .dl-thumb-play {
    position: absolute;
    top: 50%;
    left: 50%;
    display: inline-flex;
    justify-content: center;
    align-items: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: color-mix(in oklab, var(--bg) 85%, transparent);
    color: var(--fg);
    pointer-events: none;
    translate: -50% -50%;

    :global(svg) {
      width: 14px;
      height: 14px;
    }
  }

  .dl-thumb-duration {
    position: absolute;
    bottom: 4px;
    left: 4px;
    padding: 2px 6px;
    border-radius: 6px;
    background: color-mix(in oklab, var(--bg) 75%, transparent);
    color: var(--fg);
    font-weight: 600;
    font-size: 0.6875rem;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
  }

  .dl-info {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .dl-title {
    display: -webkit-box;
    overflow: hidden;
    font-weight: 600;
    font-size: 0.8125rem;
    line-height: 1.35;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .dl-title-button {
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    font-weight: 600;
    text-align: start;
    cursor: pointer;
    transition: color 150ms;

    &:hover {
      color: var(--accent);
    }

    &:focus-visible {
      border-radius: 4px;
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
  }

  .dl-byline {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: baseline;
    overflow: hidden;
    color: var(--fg-muted);
    font-size: 0.71875rem;
  }

  .dl-byline-sep {
    color: var(--fg-subtle);
  }

  .dl-channel {
    overflow: hidden;
    min-width: 0;
    color: var(--fg-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dl-watch-link {
    padding: 0;
    border: none;
    background: transparent;
    color: var(--accent);
    font: inherit;
    font-weight: 500;
    cursor: pointer;

    &:hover {
      text-decoration: underline;
    }

    &:focus-visible {
      border-radius: 4px;
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
  }

  .dl-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 2px;
  }

  .dl-chip {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 7px;
    border-radius: 6px;
    background: var(--surface-high);
    color: var(--fg);
    font-weight: 600;
    font-size: 0.6875rem;
  }

  .dl-chip-accent {
    background: var(--accent-container);
  }

  .dl-actions {
    display: flex;
    flex-shrink: 0;
    gap: 2px;
  }

  .dl-action {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: none;
    border-radius: 15px;
    background: transparent;
    color: var(--fg-subtle);
    cursor: pointer;
    transition: background-color 200ms, color 200ms;

    &:hover {
      background: var(--accent-hover);
      color: var(--fg);
    }

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    :global(svg) {
      width: 16px;
      height: 16px;
    }
  }

  .dl-cancel:hover {
    background: var(--danger-hover);
    color: var(--danger);
  }

  .dl-cancel:focus-visible {
    outline-color: var(--danger);
  }

  .dl-prog-bar {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .dl-prog-pct {
    flex-shrink: 0;
    color: var(--accent);
    font-weight: 700;
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
  }

  .dl-prog-line {
    display: flex;
    gap: 8px;
    justify-content: space-between;
    align-items: baseline;
  }

  .dl-prog-stat {
    overflow: hidden;
    color: var(--fg-muted);
    font-size: 0.71875rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .state-pill {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    padding: 4px 8px;
    border-radius: 999px;
    font-weight: 600;
    font-size: 0.6875rem;
  }

  .state-processing {
    background: var(--accent-container);
    color: var(--fg);
  }

  .state-spinner {
    width: 10px;
    height: 10px;
    border: 1.5px solid color-mix(in oklab, var(--accent) 30%, transparent);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: dl-spin 700ms linear infinite;
  }

  @keyframes dl-spin {
    to {
      rotate: 360deg;
    }
  }

  .state-queued {
    background: var(--surface-high);
    color: var(--fg-muted);
  }
</style>

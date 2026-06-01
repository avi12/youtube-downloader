<script lang="ts">
  import WavyProgress from "../components/WavyProgress.svelte";

  interface Props {
    filename: string;
    progress: number | null;
    progressLabel: string;
    statusLabel?: string | null;
    quality?: string;
    videoId?: string;
    oncancel: () => void;
  }

  const { filename, progress, progressLabel, statusLabel, quality, videoId, oncancel }: Props = $props();

  const YT_THUMBNAIL_HOST = "https://i.ytimg.com/vi";
  const thumbnailUrl = $derived(videoId ? `${YT_THUMBNAIL_HOST}/${videoId}/mqdefault.jpg` : null);
  let isThumbnailBroken = $state(false);

  const isProcessing = $derived(
    (progress !== null && progressLabel.includes("processed"))
    || statusLabel === "Processing…"
    || statusLabel === "Waiting for FFmpeg…"
  );
  const isQueued = $derived(progress === null && statusLabel === "Downloading");
</script>

<article class="dl-card">
  <div class="dl-row">
    {#if thumbnailUrl && !isThumbnailBroken}
      <img
        class="dl-thumb"
        alt=""
        height="52"
        onerror={() => (isThumbnailBroken = true)}
        src={thumbnailUrl}
        width="92"
      />
    {:else}
      <div class="dl-thumb dl-thumb-placeholder" aria-hidden="true"></div>
    {/if}

    <div class="dl-info">
      <span class="dl-title">{filename}</span>
      {#if quality}
        <div class="dl-chips">
          <span class="dl-chip">{quality}</span>
        </div>
      {/if}
    </div>

    <button
      class="dl-cancel"
      aria-label="Cancel download of {filename}"
      data-tooltip="Cancel download"
      data-tooltip-align="end"
      onclick={oncancel}
    >
      <svg aria-hidden="true" fill="currentColor" height="18" viewBox="0 -960 960 960" width="18" xmlns="http://www.w3.org/2000/svg">
        <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z" />
      </svg>
    </button>
  </div>

  {#if isProcessing}
    <div class="dl-prog-bar">
      <WavyProgress indeterminate />
    </div>
    <div class="dl-prog-line">
      <span class="state-pill state-processing">Processing</span>
    </div>
  {:else if isQueued}
    <div class="dl-prog-line">
      <span class="state-pill state-queued">Queued</span>
      <span class="dl-prog-stat">Waiting for a free slot</span>
    </div>
  {:else if progress !== null}
    <div class="dl-prog-bar">
      <WavyProgress value={progress * 100} />
      <span class="dl-prog-pct">{progressLabel}</span>
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

  .dl-thumb {
    flex-shrink: 0;
    object-fit: cover;
    width: 92px;
    height: 52px;
    border-radius: 12px;
    background: var(--surface-high);
  }

  .dl-thumb-placeholder {
    background: linear-gradient(135deg, var(--surface-high), var(--border));
  }

  .dl-info {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }

  .dl-title {
    display: -webkit-box;
    overflow: hidden;
    font-weight: 500;
    font-size: 0.8125rem;
    line-height: 1.4;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .dl-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .dl-chip {
    display: inline-flex;
    align-items: center;
    height: 24px;
    padding: 0 9px;
    border-radius: 8px;
    background: var(--accent-container);
    color: var(--fg);
    font-weight: 600;
    font-size: 0.71875rem;
  }

  .dl-cancel {
    display: flex;
    flex-shrink: 0;
    justify-content: center;
    align-items: center;
    width: 34px;
    height: 34px;
    padding: 0;
    border: none;
    border-radius: 17px;
    background: transparent;
    color: var(--fg-subtle);
    cursor: pointer;
    transition: background-color 200ms, color 200ms;

    &:hover {
      background: var(--danger-hover);
      color: var(--danger);
    }

    &:focus-visible {
      outline: 2px solid var(--danger);
      outline-offset: 2px;
    }
  }

  .dl-prog-bar {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .dl-prog-pct {
    flex-shrink: 0;
    min-width: 34px;
    color: var(--accent);
    font-weight: 600;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .dl-prog-line {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .dl-prog-stat {
    color: var(--fg-muted);
    font-size: 0.71875rem;
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

  .state-queued {
    background: var(--surface-high);
    color: var(--fg-muted);
  }
</style>

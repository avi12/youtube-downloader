<script lang="ts">
  import closeIcon from "../icons/close.svg?raw";

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
</script>

{#if thumbnailUrl && !isThumbnailBroken}
  <img
    class="download-thumb"
    alt=""
    height="48"
    onerror={() => (isThumbnailBroken = true)}
    src={thumbnailUrl}
    width="48"
  />
{/if}
<div class="download-item-content">
  <span class="download-filename" title={filename}>{filename}</span>
  {#if quality}
    <span class="download-quality">{quality}</span>
  {/if}
  {#if progress !== null}
    <progress
      class="download-progress"
      aria-label={progressLabel}
      max={1}
      value={progress}
    ></progress>
    <span class="download-progress-label">{progressLabel}</span>
  {:else if statusLabel}
    <span class="download-status-label">{statusLabel}</span>
  {/if}
</div>
<button
  class="item-cancel-button"
  aria-label="Cancel download of {filename}"
  onclick={oncancel}
>
  {@html closeIcon}
</button>

<style>
  .download-thumb {
    flex-shrink: 0;
    object-fit: cover;
    width: 48px;
    height: 48px;
    border-radius: 8px;
    background: var(--surface-high);
  }

  .download-item-content {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .download-filename {
    overflow: hidden;
    font-size: 0.75rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .download-quality {
    color: var(--fg-subtle);
    font-size: 0.6875rem;
  }

  .download-progress {
    appearance: none;
    width: 100%;
    height: 4px;
    border: none;
    border-radius: 2px;

    &::-webkit-progress-bar {
      border-radius: 2px;
      background: var(--border);
    }

    &::-webkit-progress-value {
      border-radius: 2px;
      background: var(--accent);
    }

    &::-moz-progress-bar {
      border-radius: 2px;
      background: var(--accent);
    }
  }

  .download-progress-label,
  .download-status-label {
    color: var(--fg-subtle);
    font-size: 0.6875rem;
  }

  .item-cancel-button {
    display: flex;
    flex-shrink: 0;
    justify-content: center;
    align-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 14px;
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
</style>

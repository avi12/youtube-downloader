<script lang="ts">
  import closeIcon from "../icons/close.svg?raw";

  interface Props {
    filename: string;
    progress: number | null;
    progressLabel: string;
    statusLabel?: string | null;
    quality?: string;
    outputBadge?: string;
    oncancel: () => void;
  }

  const { filename, progress, progressLabel, statusLabel, quality, outputBadge, oncancel }: Props = $props();
</script>

<div class="download-item-content">
  <span class="download-filename" title={filename}>{filename}</span>
  <div class="download-meta">
    {#if quality}
      <span class="download-quality">{quality}</span>
    {/if}
    {#if outputBadge}
      <span class="download-output-badge">{outputBadge}</span>
    {/if}
  </div>
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

  .download-meta {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .download-quality {
    color: var(--fg-subtle);
    font-size: 0.6875rem;
  }

  .download-output-badge {
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--fg-subtle);
    font-size: 0.625rem;
    font-weight: 500;
    letter-spacing: 0.03em;
    text-transform: uppercase;
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

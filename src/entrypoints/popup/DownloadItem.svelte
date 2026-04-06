<script lang="ts">
  type Props = {
    filename: string;
    progress: number | null;
    progressLabel: string;
    statusLabel?: string;
    oncancel: () => void;
  };

  const { filename, progress, progressLabel, statusLabel, oncancel }: Props = $props();
</script>

{#snippet closeIcon()}
  <svg
    aria-hidden="true"
    fill="currentColor"
    height="16"
    viewBox="0 0 24 24"
    width="16"
  >
    <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
  </svg>
{/snippet}

<div class="download-item-content">
  <span class="download-filename" title={filename}>{filename}</span>
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
  {@render closeIcon()}
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

  .download-progress {
    width: 100%;
    height: 4px;
    border: none;
    border-radius: 2px;
    appearance: none;

    &::-webkit-progress-bar {
      border-radius: 2px;
      background: var(--border);
    }

    &::-webkit-progress-value {
      border-radius: 2px;
      background: var(--accent);
      transition: width 300ms cubic-bezier(0.2, 0, 0, 1);
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

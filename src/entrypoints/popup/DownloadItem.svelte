<script lang="ts">
  import closeIcon from "./icons/close.svg?raw";

  interface Props {
    filename: string;
    progress: number | null;
    progressLabel: string;
    statusLabel?: string | null;
    quality?: string;
    oncancel: () => void;
  }

  const { filename, progress, progressLabel, statusLabel, quality, oncancel }: Props = $props();
</script>

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

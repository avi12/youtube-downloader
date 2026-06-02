<script lang="ts">
  import { PROGRESS_RING_CIRCUMFERENCE, PROGRESS_RING_RADIUS, PROGRESS_RING_SVG_SIZE } from "./download-ring-geometry";

  interface Props {
    progress: number;
    isIndeterminate: boolean;
    isError: boolean;
    ariaLabel?: string;
  }

  const { progress, isIndeterminate, isError, ariaLabel }: Props = $props();
</script>

<svg
  class="ytdl-download-ring"
  class:ytdl-download-ring--error={isError}
  class:ytdl-download-ring--indeterminate={isIndeterminate}
  aria-hidden={ariaLabel ? undefined : true}
  aria-label={ariaLabel}
  viewBox="0 0 {PROGRESS_RING_SVG_SIZE} {PROGRESS_RING_SVG_SIZE}"
>
  <circle
    class="ytdl-download-ring__track"
    cx={PROGRESS_RING_SVG_SIZE / 2}
    cy={PROGRESS_RING_SVG_SIZE / 2}
    r={PROGRESS_RING_RADIUS}
  />
  <circle
    class="ytdl-download-ring__indicator"
    cx={PROGRESS_RING_SVG_SIZE / 2}
    cy={PROGRESS_RING_SVG_SIZE / 2}
    r={PROGRESS_RING_RADIUS}
    stroke-dasharray={PROGRESS_RING_CIRCUMFERENCE}
    stroke-dashoffset={PROGRESS_RING_CIRCUMFERENCE * (1 - progress)}
  />
</svg>

<style>
  .ytdl-download-ring {
    position: absolute;
    inset: 0;
    overflow: visible;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .ytdl-download-ring__track {
    fill: none;
    stroke: currentColor;
    stroke-opacity: 25%;
    stroke-width: 2.4;
  }

  .ytdl-download-ring__indicator {
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-width: 2.4;
    transition: stroke-dashoffset 160ms ease-out;
    rotate: -90deg;
    transform-origin: center;

    .ytdl-download-ring--error & {
      stroke-dashoffset: 0;
    }

    .ytdl-download-ring--indeterminate & {
      stroke-dasharray: 30 70;
      transition: none;
      animation: ytdl-download-ring-spin 1400ms linear infinite;
    }
  }

  @keyframes ytdl-download-ring-spin {
    from {
      rotate: -90deg;
    }

    to {
      rotate: 270deg;
    }
  }
</style>

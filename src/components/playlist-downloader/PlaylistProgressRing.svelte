<script lang="ts">
  interface Props {
    ariaLabel: string;
    isIndeterminate: boolean;
    value: number;
  }

  const { ariaLabel, isIndeterminate, value }: Props = $props();

  const RADIUS = 17;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
</script>

<svg
  class="ytdl-circular-progress"
  aria-label={ariaLabel}
  viewBox="0 0 40 40"
>
  <circle class="track" cx="20" cy="20" r={RADIUS} />
  <circle
    style={isIndeterminate ? undefined : `stroke-dashoffset: ${CIRCUMFERENCE * (1 - value / 100)}`}
    class="fill"
    class:indeterminate={isIndeterminate}
    cx="20"
    cy="20"
    r={RADIUS}
  />
</svg>

<style>
  .ytdl-circular-progress {
    position: absolute;
    inset: 0;
    overflow: visible;
    width: 100%;
    height: 100%;
    pointer-events: none;
    rotate: -90deg;

    .track {
      fill: none;
      stroke: var(--yt-sys-color-baseline--additive-background, rgb(0 0 0 / 10%));
      stroke-width: 2.5;
    }

    .fill {
      fill: none;
      stroke: var(--yt-sys-color-baseline--inverted-background, #ff0000);
      stroke-dasharray: 106.81;
      stroke-linecap: round;
      stroke-width: 2.5;
      transition: stroke-dashoffset 300ms ease;

      &.indeterminate {
        stroke-dasharray: 40 66.81;
        animation: ytdl-circular-spin 1000ms linear infinite;
      }
    }
  }

  @keyframes ytdl-circular-spin {
    to {
      stroke-dashoffset: -106.81;
    }
  }
</style>

<script lang="ts">
  interface Props {
    value?: number;
    indeterminate?: boolean;
  }

  const HEIGHT = 14;
  const AMP = 2.5;
  const WAVELENGTH = 12;
  const PAD = 3;
  const GAP = 6;
  const EXTEND = WAVELENGTH * 3;

  let { value = 0, indeterminate = false }: Props = $props();

  let container: HTMLDivElement | null = $state(null);
  let containerWidth = $state(0);

  $effect(() => {
    if (!container) {
      return;
    }

    containerWidth = container.clientWidth;
    const resizeObserver = new ResizeObserver(() => {
      containerWidth = container!.clientWidth;
    });
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  });

  const clampedValue = $derived(indeterminate ? 100 : Math.max(0, Math.min(100, value)));
  const centerY = HEIGHT / 2;
  const usable = $derived(Math.max(0, containerWidth - PAD * 2));
  const activeEnd = $derived((clampedValue / 100) * usable);
  const trackStart = $derived(PAD + activeEnd + GAP);
  const trackEnd = $derived(containerWidth - PAD);
  const clipId = `wavy-${Math.random().toString(36).slice(2, 8)}`;

  // fallow-ignore-next-line complexity
  const wavePath = $derived.by(() => {
    if (containerWidth <= 0 || clampedValue <= 0.5) {
      return "";
    }

    let path = "";
    for (let xPos = -EXTEND; xPos <= activeEnd + EXTEND; xPos += 1.5) {
      const yPos = centerY + AMP * Math.sin((xPos / WAVELENGTH) * Math.PI * 2);
      path += (path === "" ? "M" : "L") + (PAD + xPos).toFixed(1) + " " + yPos.toFixed(2) + " ";
    }
    return path;
  });
</script>

<div bind:this={container} class="prog-wave">
  {#if containerWidth > 0}
    <svg
      class="prog-svg"
      aria-hidden="true"
      preserveAspectRatio="none"
      viewBox="0 0 {containerWidth} {HEIGHT}"
    >
      <defs>
        <clipPath id={clipId}>
          <rect height={HEIGHT} width={Math.max(0, PAD + activeEnd)} x="0" y="0" />
        </clipPath>
      </defs>
      {#if trackStart < trackEnd}
        <line class="prog-track" x1={trackStart} x2={trackEnd} y1={centerY} y2={centerY} />
      {/if}
      {#if wavePath}
        <g clip-path="url(#{clipId})">
          <path
            class="prog-active"
            d={wavePath}
          />
        </g>
      {/if}
      {#if clampedValue > 0.5 && !indeterminate}
        <circle class="prog-dot" cx={PAD + activeEnd} cy={centerY} r="3" />
      {/if}
    </svg>
  {/if}
</div>

<style>
  .prog-wave {
    flex: 1;
    overflow: visible;
    min-width: 0;
    height: 14px;
  }

  .prog-track {
    fill: none;
    stroke: var(--border);
    stroke-linecap: round;
    stroke-width: 4;
  }

  .prog-svg {
    display: block;
    overflow: visible;
    width: 100%;
    height: 14px;
  }

  .prog-active {
    fill: none;
    stroke: var(--accent);
    stroke-linecap: round;
    stroke-width: 4;
    /* stylelint-disable-next-line no-unknown-animations */
    animation: wave-shift calc(1050ms / var(--motion, 1)) linear infinite;
  }

  .prog-dot {
    fill: var(--accent);
  }

  @keyframes wave-shift {
    from{ translate: 0; }
    to{ translate: -24px; }
  }
</style>

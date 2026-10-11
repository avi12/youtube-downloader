<script lang="ts">
  interface Props {
    label: string;
    side: "start" | "end";
  }

  const { label, side }: Props = $props();
</script>

<span class="thumbnail-badge thumbnail-badge--{side}">{label}</span>

<style>
  .thumbnail-badge {
    position: absolute;
    bottom: 4px;
    padding: 2px 6px;
    border-radius: 6px;
    background: color-mix(in oklab, var(--bg) 75%, transparent);
    color: var(--fg);
    font-weight: 600;
    font-size: 0.6875rem;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;

    &.thumbnail-badge--start {
      left: 4px;
    }

    &.thumbnail-badge--end {
      right: 4px;
    }
  }
</style>

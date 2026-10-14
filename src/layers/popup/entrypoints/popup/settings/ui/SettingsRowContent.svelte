<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    lead?: Snippet;
    isAccent?: boolean;
    label: string;
    subtitle?: string;
    trail: Snippet;
  }

  const { lead, isAccent, label, subtitle, trail }: Props = $props();
</script>

{#if lead}
  <div class="set-lead" class:accent={isAccent}>
    {@render lead()}
  </div>
{/if}
<div class="set-txt">
  <span class="set-label">{label}</span>
  {#if subtitle}
    <span class="set-sub">{subtitle}</span>
  {/if}
</div>
<div class="set-trail">
  {@render trail()}
</div>

<style>
  .set-lead {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: var(--surface-high);
    color: var(--fg-muted);

    &.accent {
      background: var(--accent-container);
      color: var(--fg);
    }

    :global(svg) {
      width: 20px;
      height: 20px;
    }
  }

  .set-txt {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .set-label {
    color: var(--fg);
    font-weight: 500;
    font-size: 0.84375rem;
  }

  .set-sub {
    color: var(--fg-muted);
    font-size: 0.71875rem;
  }

  .set-trail {
    display: flex;
    flex-shrink: 0;
    gap: 8px;
    align-items: center;
    color: var(--fg-muted);
  }
</style>

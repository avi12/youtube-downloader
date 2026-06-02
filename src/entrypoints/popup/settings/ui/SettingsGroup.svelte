<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    children: Snippet;
  }

  const { title, children }: Props = $props();
</script>

<section class="set-group">
  <h3 class="set-group-title">{title}</h3>
  <div class="set-card">
    {@render children()}
  </div>
</section>

<style>
  .set-group {
    display: flex;
    flex-direction: column;
  }

  .set-group-title {
    margin: 0;
    padding-block: 14px 6px;
    padding-inline: 6px;
    color: var(--accent);
    font-weight: 600;
    font-size: 0.75rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .set-card {
    overflow: hidden;
    border-radius: 20px;
    background: var(--surface);

    :global(.set-item + .set-item),
    :global(.set-section-fieldset + .set-item) {
      border-top: 1px solid var(--border);
    }
  }
</style>

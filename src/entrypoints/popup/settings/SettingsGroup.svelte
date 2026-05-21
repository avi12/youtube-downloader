<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    children: Snippet;
  }

  const { title, children }: Props = $props();
</script>

<fieldset class="settings-group">
  <legend class="settings-legend">{title}</legend>
  {@render children()}
</fieldset>

<style>
  .settings-group {
    display: grid;
    padding: 16px;
    border: none;
    border-radius: 16px;
    background: var(--surface);
  }

  .settings-legend {
    margin-bottom: 8px;
    padding: 0;
    color: var(--accent);
    font-weight: 500;
    font-size: 0.875rem;
    letter-spacing: 0.02em;
  }
</style>

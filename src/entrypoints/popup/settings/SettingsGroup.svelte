<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    children: Snippet;
  }

  const { title, children }: Props = $props();
</script>

<div class="set-group">
  <div class="set-group-title">{title}</div>
  <div class="set-card">
    {@render children()}
  </div>
</div>

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

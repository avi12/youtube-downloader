<script lang="ts">
  interface Props {
    size?: number;
  }

  const { size = 20 }: Props = $props();
</script>

<svg aria-hidden="true" fill="currentColor" height={size} viewBox="0 -960 960 960" width={size} xmlns="http://www.w3.org/2000/svg">
  <path d="M320-200v-560l440 280-440 280Zm80-280Zm0 134 210-134-210-134v268Z" />
</svg>

<script lang="ts">
  interface Props {
    size?: number;
  }

  const { size = 20 }: Props = $props();
  const PATH = "M480-240 280-400l57-56 143 114 143-114 57 56-200 160Zm0-160L280-560l57-56 143 114 143-114 57 56-200 160Zm0-160L280-720l200-160 200 160-200 160Z";
</script>

<svg aria-hidden="true" fill="currentColor" height={size} viewBox="0 -960 960 960" width={size} xmlns="http://www.w3.org/2000/svg">
  <path d={PATH} />
</svg>

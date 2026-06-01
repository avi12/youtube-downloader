<script lang="ts">
  interface Props {
    size?: number;
  }

  const { size = 20 }: Props = $props();
  const PATH = "m280-80 80-172-172-80 172-80-80-172 80 172 172-80-172 80 80 172Zm424-360-56-124-56 124-124 56 124 56 56 124 56-124 124-56-124-56Zm-284 36Z";
</script>

<svg aria-hidden="true" fill="currentColor" height={size} viewBox="0 -960 960 960" width={size} xmlns="http://www.w3.org/2000/svg">
  <path d={PATH} />
</svg>

<script lang="ts">
  interface Props {
    size?: number;
  }

  const { size = 18 }: Props = $props();
</script>

<svg aria-hidden="true" fill="currentColor" height={size} viewBox="0 -960 960 960" width={size} xmlns="http://www.w3.org/2000/svg">
  <path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z" />
</svg>

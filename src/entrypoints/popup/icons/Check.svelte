<script lang="ts">
  interface Props {
    size?: number;
  }

  const { size = 18 }: Props = $props();
</script>

<svg aria-hidden="true" fill="currentColor" height={size} viewBox="0 -960 960 960" width={size} xmlns="http://www.w3.org/2000/svg">
  <path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z" />
</svg>

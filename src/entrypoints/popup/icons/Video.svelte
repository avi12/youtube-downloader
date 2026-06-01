<script lang="ts">
  interface Props {
    size?: number;
  }

  const { size = 20 }: Props = $props();
  const PATH = "M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm0-80h640v-480H160v480Zm160-80 200-120-200-120v240Zm-160 80v-480 480Z";
</script>

<svg aria-hidden="true" fill="currentColor" height={size} viewBox="0 -960 960 960" width={size} xmlns="http://www.w3.org/2000/svg">
  <path d={PATH} />
</svg>

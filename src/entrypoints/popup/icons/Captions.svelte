<script lang="ts">
  interface Props {
    size?: number;
  }

  const { size = 20 }: Props = $props();
  const PATH = "M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm0-80h640v-480H160v480Zm80-120h200v-80H240v80Zm240 0h240v-80H480v80ZM240-440h80v-80h-80v80Zm160 0h80v-80h-80v80Zm160 0h80v-80h-80v80Zm80-160H240v-80h400v80Z";
</script>

<svg aria-hidden="true" fill="currentColor" height={size} viewBox="0 -960 960 960" width={size} xmlns="http://www.w3.org/2000/svg">
  <path d={PATH} />
</svg>

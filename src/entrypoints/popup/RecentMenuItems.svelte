<script lang="ts">
  interface Props {
    isZip: boolean;
    onShowInFolder: () => void;
    onChangeFormat: () => void;
    onRemove: () => void;
  }

  const { isZip, onShowInFolder, onChangeFormat, onRemove }: Props = $props();
</script>

<button
  class="recent-menu-item"
  dir="auto"
  onclick={onShowInFolder}
  role="menuitem"
  type="button"
>
  Show in folder
</button>
{#if !isZip}
  <button
    class="recent-menu-item"
    dir="auto"
    onclick={onChangeFormat}
    role="menuitem"
    type="button"
  >
    Change format…
  </button>
{/if}
<button
  class="recent-menu-item recent-menu-item-danger"
  dir="auto"
  onclick={onRemove}
  role="menuitem"
  type="button"
>
  Remove
</button>

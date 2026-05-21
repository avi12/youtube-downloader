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

<style>
  .recent-menu-item {
    padding: 8px 12px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--fg);
    font-family: inherit;
    font-size: 0.8125rem;
    cursor: pointer;

    &:hover,
    &:focus-visible {
      background: var(--accent-container);
      color: var(--fg);
    }

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }
  }

  .recent-menu-item-danger {
    color: var(--danger);

    &:hover,
    &:focus-visible {
      background: var(--danger-hover);
      color: var(--danger);
    }
  }
</style>

<script lang="ts">
  import moreActionsIcon from "./icons/more-actions.svg?raw";

  interface Props {
    entryId: string;
    isZip: boolean;
    onShowInFolder: () => void;
    onChangeFormat: () => void;
    onRemove: () => void;
    onMenuOpenChange?: (isOpen: boolean) => void;
  }

  const { entryId, isZip, onShowInFolder, onChangeFormat, onRemove, onMenuOpenChange }: Props = $props();

  let isMenuOpen = $state(false);
  let elMenu = $state<HTMLDivElement | null>(null);
  let elTrigger = $state<HTMLButtonElement | null>(null);

  function setMenuOpen(value: boolean) {
    isMenuOpen = value;
    onMenuOpenChange?.(value);
  }

  function closeMenu() {
    setMenuOpen(false);
    elTrigger?.focus();
  }

  function handleMenuAction(action: () => void) {
    action();
    closeMenu();
  }

  function handleDocumentClick(e: MouseEvent) {
    if (!isMenuOpen) {
      return;
    }

    const { target } = e;
    const isClickInsideMenu = target instanceof Node && (elMenu?.contains(target) || elTrigger?.contains(target));
    if (isClickInsideMenu) {
      return;
    }

    closeMenu();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (isMenuOpen && e.key === "Escape") {
      e.preventDefault();
      closeMenu();
    }
  }

  $effect(() => {
    if (!isMenuOpen) {
      return;
    }

    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
      document.removeEventListener("keydown", handleKeydown);
    };
  });
</script>

<div class="recent-menu-wrap">
  <button
    bind:this={elTrigger}
    style="anchor-name: --menu-{entryId};"
    class="recent-menu-trigger"
    aria-expanded={isMenuOpen}
    aria-haspopup="menu"
    aria-label="More actions"
    onclick={() => setMenuOpen(!isMenuOpen)}
    type="button"
  >
    {@html moreActionsIcon}
  </button>

  {#if isMenuOpen}
    <div
      bind:this={elMenu}
      style="position-anchor: --menu-{entryId};"
      class="recent-menu"
      role="menu"
    >
      <button
        class="recent-menu-item"
        dir="auto"
        onclick={() => handleMenuAction(onShowInFolder)}
        role="menuitem"
        type="button"
      >
        Show in folder
      </button>
      {#if !isZip}
        <button
          class="recent-menu-item"
          dir="auto"
          onclick={() => handleMenuAction(onChangeFormat)}
          role="menuitem"
          type="button"
        >
          Change format…
        </button>
      {/if}
      <button
        class="recent-menu-item recent-menu-item-danger"
        dir="auto"
        onclick={() => handleMenuAction(onRemove)}
        role="menuitem"
        type="button"
      >
        Remove
      </button>
    </div>
  {/if}
</div>

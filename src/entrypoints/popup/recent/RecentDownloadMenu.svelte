<script lang="ts">
  import MoreActions from "../icons/MoreActions.svelte";
  import RecentMenuItems from "./RecentMenuItems.svelte";

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

  function setMenuOpen(value: boolean): void {
    isMenuOpen = value;
    onMenuOpenChange?.(value);
  }

  function closeMenu(): void {
    setMenuOpen(false);
    elTrigger?.focus();
  }

  function handleMenuAction(action: () => void): void {
    action();
    closeMenu();
  }

  function isOutsideMenu(target: Node): boolean {
    return !elMenu?.contains(target) && !elTrigger?.contains(target);
  }

  function handleDocumentClick(e: MouseEvent): void {
    if (isMenuOpen && e.target instanceof Node && isOutsideMenu(e.target)) {
      closeMenu();
    }
  }

  function handleKeydown(e: KeyboardEvent): void {
    const isEscapeWhileOpen = isMenuOpen && e.key === "Escape";
    if (isEscapeWhileOpen) {
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
    style:anchor-name="--menu-{entryId}"
    class="recent-menu-trigger"
    aria-expanded={isMenuOpen}
    aria-haspopup="menu"
    aria-label="More actions"
    onclick={() => setMenuOpen(!isMenuOpen)}
    type="button"
  >
    <MoreActions size={20} />
  </button>

  {#if isMenuOpen}
    <div
      bind:this={elMenu}
      style:position-anchor="--menu-{entryId}"
      class="recent-menu"
      role="menu"
    >
      <RecentMenuItems
        {isZip}
        onChangeFormat={() => handleMenuAction(onChangeFormat)}
        onRemove={() => handleMenuAction(onRemove)}
        onShowInFolder={() => handleMenuAction(onShowInFolder)}
      />
    </div>
  {/if}
</div>

<style>
  .recent-menu-wrap {
    flex-shrink: 0;
  }

  .recent-menu-trigger {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--fg-muted);
    cursor: pointer;
    transition: background-color 150ms;

    &:hover {
      background: var(--surface-high);
    }

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
  }

  .recent-menu {
    position: fixed;
    top: anchor(bottom);
    right: anchor(right);
    z-index: 10;
    display: flex;
    flex-direction: column;
    min-width: 160px;
    padding: 4px;
    border-radius: 12px;
    background: var(--surface-high);
    box-shadow: 0 4px 16px rgb(0 0 0 / 15%);
    animation: menu-in 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
    position-try-fallbacks: flip-block;
  }

  @keyframes menu-in {
    from {
      opacity: 0%;
      transform: scale(0.92) translateY(-4px);
    }

    to {
      opacity: 100%;
      transform: scale(1) translateY(0);
    }
  }
</style>

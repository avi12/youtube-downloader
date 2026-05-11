<script lang="ts">
  interface Props {
    id?: string;
    label: string;
    options: {
      value: string;
      label: string;
    }[];
    value: string;
    disabled?: boolean;
    onchange: (value: string) => void;
  }

  const {
    id, label, options, value, disabled = false, onchange
  }: Props = $props();

  let isOpen = $state(false);
  let elTrigger = $state<HTMLElement | null>(null);
  let elMenu = $state<HTMLElement | null>(null);

  const selectedLabel = $derived(options.find(option => option.value === value)?.label ?? "");

  function attachTrigger(elTarget: Element) {
    if (!(elTarget instanceof HTMLElement)) {
      return;
    }

    elTrigger = elTarget;

    function handleClick(e: Event) {
      e.stopPropagation();
      isOpen = !isOpen;
    }

    function handleKeydown(e: Event) {
      if (!(e instanceof KeyboardEvent)) {
        return;
      }

      const isActivationKey = e.key === "ArrowDown" || e.key === "Enter" || e.key === " ";
      if (isActivationKey) {
        e.preventDefault();
        isOpen = true;
      }
    }

    elTarget.addEventListener("click", handleClick);
    elTarget.addEventListener("keydown", handleKeydown);

    return () => {
      elTarget.removeEventListener("click", handleClick);
      elTarget.removeEventListener("keydown", handleKeydown);
    };
  }

  function attachMenu(elTarget: Element) {
    if (!(elTarget instanceof HTMLElement)) {
      return;
    }

    elMenu = elTarget;

    function handleSelectedChanged(e: Event) {
      if (!(e instanceof CustomEvent)) {
        return;
      }

      const dataValue: string = e.detail?.value;
      if (!dataValue) {
        return;
      }

      if (dataValue !== value) {
        onchange(dataValue);
      }

      isOpen = false;
      // Return focus to the trigger so Tab moves to the next form control.
      elTrigger?.focus();
    }

    function handleKeydown(e: Event) {
      if (!(e instanceof KeyboardEvent)) {
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        isOpen = false;
        elTrigger?.focus();
        return;
      }

      if (e.key === "Tab") {
        // Close + move focus to the trigger so the browser's Tab default
        // moves from the trigger to the next form control.
        isOpen = false;
        elTrigger?.focus();
        return;
      }

      // tp-yt-paper-listbox doesn't fire selected-changed when Enter lands
      // on the already-selected item; close + restore focus manually so the
      // dropdown doesn't stay open with the user's keyboard "consumed".
      if (e.key === "Enter" || e.key === " ") {
        const elActive = document.activeElement;
        if (elActive instanceof HTMLElement && elActive.matches("tp-yt-paper-item")) {
          const dataValue = elActive.getAttribute("data-value");
          if (dataValue === value) {
            e.preventDefault();
            isOpen = false;
            elTrigger?.focus();
          }
        }
      }
    }

    elTarget.addEventListener("selected-changed", handleSelectedChanged);
    elTarget.addEventListener("keydown", handleKeydown);

    return () => {
      elTarget.removeEventListener("selected-changed", handleSelectedChanged);
      elTarget.removeEventListener("keydown", handleKeydown);
    };
  }

  function focusListbox(elListbox: HTMLElement) {
    // Focus the listbox container so IronMenuBehavior's _focusedItem gets set
    // to the selected item via its own _shiftTabPressed/_focusFirstItem flow.
    // Manually focusing an item bypasses that and leaves arrow nav broken.
    elListbox.focus();
  }

  function syncMenuMaxHeight() {
    if (!elTrigger || !elMenu) {
      return;
    }

    const triggerBottom = elTrigger.getBoundingClientRect().bottom;
    // Account for the gap below the trigger, the menu's own border + padding
    // (1px + 4px on each side), and a viewport-edge breathing margin.
    const GAP = 4;
    const MENU_CHROME = 10;
    const VIEWPORT_MARGIN = 8;
    const available = innerHeight - triggerBottom - GAP - MENU_CHROME - VIEWPORT_MARGIN;
    elMenu.style.maxHeight = `${Math.max(available, 120)}px`;
  }

  $effect(() => {
    if (!isOpen || !elMenu) {
      return;
    }

    const elMenuEl = elMenu;
    syncMenuMaxHeight();
    requestAnimationFrame(() => focusListbox(elMenuEl));

    function handleOutsideClick(e: MouseEvent) {
      if (!(e.target instanceof Node)) {
        return;
      }

      if (elTrigger?.contains(e.target) || elMenu?.contains(e.target)) {
        return;
      }

      isOpen = false;
    }

    // Resize fires before iron-fit re-anchors the parent panel (which shifts
    // the trigger), so a same-tick measurement reads stale trigger.bottom.
    // Defer to rAF so the layout settles before computing available space.
    function handleViewportResize() {
      requestAnimationFrame(syncMenuMaxHeight);
    }

    document.addEventListener("mousedown", handleOutsideClick, true);
    addEventListener("resize", handleViewportResize);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick, true);
      removeEventListener("resize", handleViewportResize);
    };
  });
</script>

<div class="ytdl-select-field">
  <label class="ytdl-select-label" for={id}>{label}</label>
  <button
    {id}
    class="ytdl-select-trigger"
    class:ytdl-select-trigger--open={isOpen}
    {@attach attachTrigger}
    aria-expanded={isOpen}
    aria-haspopup="listbox"
    aria-label={label}
    disabled={disabled || undefined}
    type="button"
  >
    <span class="ytdl-select-trigger__value">{selectedLabel}</span>
    <svg
      class="ytdl-select-trigger__chevron"
      class:ytdl-select-trigger__chevron--open={isOpen}
      aria-hidden="true"
      fill="none"
      height="18"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      viewBox="0 0 24 24"
      width="18"
    >
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  </button>

  {#if isOpen}
    <tp-yt-paper-listbox
      class="ytdl-select-menu"
      {@attach attachMenu}
      aria-label={label}
      attr-for-selected="data-value"
      role="listbox"
      selected={value}
    >
      {#each options as option (option.value)}
        <tp-yt-paper-item
          aria-selected={option.value === value}
          data-value={option.value}
          role="option"
          tabindex={option.value === value ? 0 : -1}
        >{option.label}</tp-yt-paper-item>
      {/each}
    </tp-yt-paper-listbox>
  {/if}
</div>

<style>
  .ytdl-select-field {
    position: relative;
  }

  .ytdl-select-label {
    display: block;
    margin-block-end: 6px;
    color: var(--yt-spec-text-secondary, #606060);
    font-weight: 500;
    font-size: 1.2rem;
  }

  :global(html[dark]) .ytdl-select-label {
    color: var(--yt-spec-text-secondary, #aaaaaa);
  }

  .ytdl-select-trigger {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    height: 40px;
    margin: 0;
    padding-block: 0;
    padding-inline: 14px 12px;
    border: 1px solid var(--yt-spec-10-percent-layer, rgb(0 0 0 / 16%));
    border-radius: 8px;
    background: transparent;
    color: var(--yt-spec-text-primary, #0f0f0f);
    font: inherit;
    font-size: 1.4rem;
    text-align: start;
    cursor: pointer;
  }

  .ytdl-select-trigger:hover {
    border-color: var(--yt-spec-text-secondary, #606060);
  }

  .ytdl-select-trigger--open {
    border-color: var(--yt-spec-call-to-action, #065fd4);
  }

  .ytdl-select-trigger:disabled {
    opacity: 50%;
    cursor: default;
  }

  :global(html[dark]) .ytdl-select-trigger {
    border-color: var(--yt-spec-10-percent-layer, rgb(255 255 255 / 16%));
    color: var(--yt-spec-text-primary, #f1f1f1);
  }

  :global(html[dark]) .ytdl-select-trigger:hover {
    border-color: var(--yt-spec-text-secondary, #aaaaaa);
  }

  :global(html[dark]) .ytdl-select-trigger--open {
    border-color: var(--yt-spec-call-to-action, #3ea6ff);
  }

  .ytdl-select-trigger__value {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ytdl-select-trigger__chevron {
    flex-shrink: 0;
    margin-inline-start: 8px;
    color: var(--yt-spec-text-secondary, #606060);
    transition: transform 120ms ease-out;
  }

  :global(html[dark]) .ytdl-select-trigger__chevron {
    color: var(--yt-spec-text-secondary, #aaaaaa);
  }

  .ytdl-select-trigger__chevron--open {
    transform: rotate(180deg);
  }

  .ytdl-select-menu {
    position: absolute;
    inset-inline: 0;
    inset-block-start: calc(100% + 4px);
    z-index: 10;
    overflow-y: auto;
    padding: 4px;
    border: 1px solid var(--yt-spec-10-percent-layer, rgb(0 0 0 / 10%));
    border-radius: 8px;
    background: var(--yt-spec-raised-background, var(--yt-spec-base-background, #ffffff));
    scrollbar-width: thin;
    box-shadow: 0 8px 32px rgb(0 0 0 / 32%), 0 2px 8px rgb(0 0 0 / 16%);
  }

  :global(html[dark]) .ytdl-select-menu {
    border-color: var(--yt-spec-10-percent-layer, rgb(255 255 255 / 10%));
    background: var(--yt-spec-raised-background, #212121);
  }

  .ytdl-select-menu :global(tp-yt-paper-item) {
    display: flex;
    align-items: center;
    min-height: 0;
    padding: 8px 10px;
    border-radius: 6px;
    color: var(--yt-spec-text-primary, #0f0f0f);
    font-size: 1.4rem;
    white-space: nowrap;
    cursor: pointer;
  }

  :global(html[dark]) .ytdl-select-menu :global(tp-yt-paper-item) {
    color: var(--yt-spec-text-primary, #f1f1f1);
  }

  .ytdl-select-menu :global(tp-yt-paper-item:hover) {
    background-color: var(--yt-spec-10-percent-layer, rgb(0 0 0 / 6%));
  }

  :global(html[dark]) .ytdl-select-menu :global(tp-yt-paper-item:hover) {
    background-color: var(--yt-spec-10-percent-layer, rgb(255 255 255 / 6%));
  }

  .ytdl-select-menu :global(tp-yt-paper-item[aria-selected="true"]) {
    font-weight: 500;
  }
</style>

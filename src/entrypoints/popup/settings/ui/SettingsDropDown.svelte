<script lang="ts">
  import checkIcon from "../../icons/check.svg?raw";
  import chevronRightIcon from "../../icons/chevron-right.svg?raw";
  import { applyInertTrap } from "@/lib/ui/inert-trap";
  import type { Snippet } from "svelte";
  import { scale } from "svelte/transition";

  interface DropDownItem {
    value: string;
    label: string;
    description?: string;
  }

  interface Props {
    label: string;
    subtitle?: string;
    displayValue: string;
    currentValue: string;
    items: DropDownItem[];
    slideDuration: number;
    onSelect: (value: string) => void;
    icon?: Snippet;
  }

  const { label, subtitle, displayValue, currentValue, items, slideDuration, onSelect, icon }: Props = $props();

  const uniqueId = crypto.randomUUID().replaceAll("-", "");
  const listboxId = `dd-listbox-${uniqueId}`;
  const headerId = `dd-header-${uniqueId}`;

  const VIEWPORT_MARGIN = 16;
  const TRIGGER_GAP = 6;

  let isOpen = $state(false);
  let elTrigger = $state<HTMLElement | null>(null);
  let elList = $state<HTMLElement | null>(null);

  function focusTrigger(): void {
    elTrigger?.focus();
  }

  function focusFirstItem(): void {
    elList?.querySelector<HTMLElement>("[role=\"option\"]")?.focus();
  }

  function navigateItems(direction: 1 | -1): void {
    const dropDownItems = [...(elList?.querySelectorAll<HTMLElement>("[role=\"option\"]") ?? [])];
    const iCurrent = dropDownItems.findIndex(item => item === document.activeElement);
    dropDownItems[(iCurrent + direction + dropDownItems.length) % dropDownItems.length]?.focus();
  }

  function handleTab(e: KeyboardEvent): void {
    isOpen = false;
    const focusable = [
      ...document.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex=\"-1\"])"
      )
    ].filter(element => !elList?.contains(element));
    const iTrigger = focusable.indexOf(elTrigger!);
    const step = e.shiftKey ? -1 : 1;
    const next = focusable[iTrigger + step];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  }

  function handleListKeydown(e: KeyboardEvent): void {
    const arrowDirections: Partial<Record<string, 1 | -1>> = {
      ArrowDown: 1,
      ArrowUp: -1
    };
    const direction = arrowDirections[e.key];
    if (direction !== undefined) {
      e.preventDefault();
      navigateItems(direction);
      return;
    }

    if (e.key === "Tab") {
      handleTab(e);
      return;
    }

    if (e.key === "Escape") {
      isOpen = false;
      focusTrigger();
    }
  }

  function handleDocumentPointerDown(e: PointerEvent): void {
    if (!(e.target instanceof Node)) {
      return;
    }

    if (elTrigger?.contains(e.target) || elList?.contains(e.target)) {
      return;
    }

    isOpen = false;
  }

  function preventOuterScroll(e: Event): void {
    if (!(e.target instanceof Node) || elList?.contains(e.target)) {
      return;
    }

    e.preventDefault();
  }

  // Anchor the list to the trigger and bound its height to the available space, in JS.
  // CSS anchor positioning diverges between Chrome and Firefox (Firefox resolves anchor()
  // but sizes the fixed list differently), so a single deterministic calculation keeps both
  // browsers identical: open below the trigger, or flip above when there's more room there,
  // and cap the height so the list scrolls instead of overflowing the popup.
  function positionList(): void {
    if (!elTrigger || !elList) {
      return;
    }

    const triggerRect = elTrigger.getBoundingClientRect();
    const spaceBelow = innerHeight - triggerRect.bottom - VIEWPORT_MARGIN - TRIGGER_GAP;
    const spaceAbove = triggerRect.top - VIEWPORT_MARGIN - TRIGGER_GAP;
    const isAbove = spaceBelow < elList.scrollHeight && spaceAbove > spaceBelow;

    elList.style.insetInlineEnd = `${innerWidth - triggerRect.right}px`;
    elList.style.insetInlineStart = "auto";
    elList.style.maxBlockSize = `${Math.max(isAbove ? spaceAbove : spaceBelow, 0)}px`;
    elList.style.transformOrigin = isAbove ? "bottom right" : "top right";

    if (isAbove) {
      elList.style.insetBlockEnd = `${innerHeight - triggerRect.top + TRIGGER_GAP}px`;
      elList.style.insetBlockStart = "auto";
    } else {
      elList.style.insetBlockStart = `${triggerRect.bottom + TRIGGER_GAP}px`;
      elList.style.insetBlockEnd = "auto";
    }
  }

  $effect(() => {
    if (!isOpen || !elList) {
      return;
    }

    positionList();

    const selectedItem = elList.querySelector<HTMLElement>("[aria-selected=\"true\"]");
    selectedItem?.scrollIntoView({
      behavior: "instant",
      block: "center"
    });

    const releaseInertTrap = applyInertTrap(elList);
    const scroller = elTrigger?.closest<HTMLElement>(".panel-wrapper");
    document.addEventListener("pointerdown", handleDocumentPointerDown);
    scroller?.addEventListener("wheel", preventOuterScroll, { passive: false });
    scroller?.addEventListener("touchmove", preventOuterScroll, { passive: false });
    return () => {
      releaseInertTrap();
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
      scroller?.removeEventListener("wheel", preventOuterScroll);
      scroller?.removeEventListener("touchmove", preventOuterScroll);
    };
  });
</script>

<button
  bind:this={elTrigger}
  class="set-item set-picker-btn"
  aria-controls={listboxId}
  aria-expanded={isOpen}
  aria-haspopup="listbox"
  onclick={e => {
    isOpen = !isOpen;

    if (isOpen && e.detail === 0) {
      requestAnimationFrame(focusFirstItem);
    }
  }}
>
  {#if icon}
    <div class="set-lead accent">
      {@render icon()}
    </div>
  {/if}
  <div class="set-txt">
    <span class="set-label">{label}</span>
    {#if subtitle}
      <span class="set-sub">{subtitle}</span>
    {/if}
  </div>
  <div class="set-trail">
    <span class="set-value">{displayValue}</span>
    <span class="set-chevron" class:set-chevron--open={isOpen}>
      {@html chevronRightIcon}
    </span>
  </div>
</button>
{#if isOpen}
  <section
    bind:this={elList}
    class="dropdown-list"
    aria-labelledby={headerId}
    transition:scale={{
      duration: slideDuration,
      start: 0.96,
      opacity: 0
    }}
  >
    <h2 id={headerId} class="dropdown-header">{label}</h2>
    <ul id={listboxId} class="dropdown-options" aria-labelledby={headerId} onkeydown={handleListKeydown} role="listbox">
      {#each items as item (item.value)}
        <li
          class="dropdown-item"
          class:dropdown-item--selected={currentValue === item.value}
          aria-selected={currentValue === item.value}
          onclick={() => {
            onSelect(item.value);
            isOpen = false;
            focusTrigger();
          }}
          onkeydown={e => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(item.value);
              isOpen = false;
              focusTrigger();
            }
          }}
          role="option"
          tabindex="-1"
        >
          <div class="dropdown-item-text">
            <span class="dropdown-item-label">{item.label}</span>
            {#if item.description}
              <span class="dropdown-item-desc">{item.description}</span>
            {/if}
          </div>
          {#if currentValue === item.value}
            {@html checkIcon}
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .set-item {
    display: flex;
    gap: 13px;
    align-items: center;
    min-height: 52px;
    padding: 13px 14px;
  }

  .set-lead {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: var(--surface-high);
    color: var(--fg-muted);

    &.accent {
      background: var(--accent-container);
      color: var(--fg);
    }

    :global(svg) {
      width: 20px;
      height: 20px;
    }
  }

  .set-txt {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .set-label {
    color: var(--fg);
    font-weight: 500;
    font-size: 0.84375rem;
  }

  .set-sub {
    color: var(--fg-muted);
    font-size: 0.71875rem;
  }

  .set-trail {
    display: flex;
    flex-shrink: 0;
    gap: 8px;
    align-items: center;
    color: var(--fg-muted);
  }

  .set-picker-btn {
    width: 100%;
    border: none;
    background: transparent;
    font-family: inherit;
    text-align: left;
    cursor: pointer;

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }

    &[aria-expanded="true"]:focus-visible {
      outline: none;
    }
  }

  .set-value {
    color: var(--accent);
    font-weight: 500;
    font-size: 0.84375rem;
    white-space: nowrap;
  }

  .set-chevron {
    display: inline-flex;
    flex-shrink: 0;
    color: var(--fg-subtle);
    transition: rotate 200ms cubic-bezier(0.2, 0, 0, 1);

    &.set-chevron--open {
      rotate: 90deg;
    }

    :global(svg) {
      width: 18px;
      height: 18px;
    }
  }

  /* Position (inset-block/inline), height cap (max-block-size) and transform-origin are set
     in JS by positionList() - the list is fixed-positioned and anchored to the trigger there,
     identically on Chrome and Firefox. */
  .dropdown-list {
    position: fixed;
    z-index: 50;
    overflow-x: clip;
    overflow-y: auto;
    overscroll-behavior: contain;
    box-sizing: border-box;
    block-size: max-content;
    width: clamp(8rem, 245px, calc(100vw - 16px));
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 20px;
    background: var(--surface);
    scrollbar-color: var(--border) transparent;
    scrollbar-width: thin;
    box-shadow:
      0 8px 24px 0 color-mix(in oklab, #000000 35%, transparent),
      0 2px 6px 0 color-mix(in oklab, #000000 25%, transparent);
  }

  .dropdown-header {
    margin: 0;
    padding-block: 10px 4px;
    padding-inline: 12px;
    color: var(--fg-muted);
    font-weight: 600;
    font-size: 0.6875rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .dropdown-options {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .dropdown-item {
    display: flex;
    gap: 8px;
    align-items: center;
    box-sizing: border-box;
    width: 100%;
    padding: 10px 12px;
    border: none;
    border-radius: 12px;
    background: transparent;
    color: var(--fg);
    font-family: inherit;
    text-align: left;
    cursor: pointer;

    &:hover {
      background: var(--surface-high);
    }

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }

    :global(svg) {
      flex-shrink: 0;
      width: 20px;
      height: 20px;
    }
  }

  .dropdown-item-text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .dropdown-item-label {
    color: inherit;
    font-weight: 600;
    font-size: 0.9375rem;
    line-height: 1.25;
  }

  .dropdown-item-desc {
    color: var(--fg-muted);
    font-size: 0.75rem;
    line-height: 1.3;
  }

  .dropdown-item--selected {
    color: var(--accent);

    .dropdown-item-desc {
      color: var(--accent);
      opacity: 75%;
    }
  }
</style>

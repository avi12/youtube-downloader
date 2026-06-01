<script lang="ts">
  import checkIcon from "../../icons/check.svg?raw";
  import chevronRightIcon from "../../icons/chevron-right.svg?raw";
  import type { Snippet } from "svelte";
  import { slide } from "svelte/transition";

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

  let isOpen = $state(false);
  let elTrigger = $state<HTMLElement | null>(null);
  let elList = $state<HTMLElement | null>(null);

  function focusTrigger(): void {
    elTrigger?.focus();
  }

  function focusFirstItem(): void {
    elList?.querySelector<HTMLElement>(".dropdown-item")?.focus();
  }

  function navigateItems(direction: 1 | -1): void {
    const dropDownItems = [...(elList?.querySelectorAll<HTMLElement>(".dropdown-item") ?? [])];
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

  function select(value: string): void {
    onSelect(value);
    isOpen = false;
    focusTrigger();
  }

  function handleTriggerClick(e: MouseEvent): void {
    isOpen = !isOpen;

    if (isOpen && e.detail === 0) {
      requestAnimationFrame(focusFirstItem);
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
</script>

<button
  bind:this={elTrigger}
  class="set-item set-picker-btn"
  aria-expanded={isOpen}
  onclick={handleTriggerClick}
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
  <div
    bind:this={elList}
    class="dropdown-list"
    onkeydown={handleListKeydown}
    transition:slide={{ duration: slideDuration }}
  >
    {#each items as item (item.value)}
      <button
        class="dropdown-item"
        class:dropdown-item--selected={currentValue === item.value}
        onclick={() => select(item.value)}
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
      </button>
    {/each}
  </div>
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
    transition: transform 200ms cubic-bezier(0.2, 0, 0, 1);

    :global(svg) {
      width: 18px;
      height: 18px;
    }
  }

  .set-chevron--open {
    transform: rotate(90deg);
  }

  .dropdown-list {
    padding: 4px;
    border-top: 1px solid var(--border);
  }

  .dropdown-item {
    display: flex;
    gap: 8px;
    align-items: center;
    width: 100%;
    padding: 9px 10px;
    border: none;
    border-radius: 12px;
    background: transparent;
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
      width: 18px;
      height: 18px;
    }
  }

  .dropdown-item-text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .dropdown-item-label {
    font-weight: 500;
    font-size: 0.84375rem;
  }

  .dropdown-item-desc {
    color: var(--fg-muted);
    font-size: 0.71875rem;
  }

  .dropdown-item--selected {
    color: var(--accent);

    .dropdown-item-desc {
      color: var(--accent);
      opacity: 70%;
    }
  }
</style>

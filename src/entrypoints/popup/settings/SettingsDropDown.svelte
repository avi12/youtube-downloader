<script lang="ts">
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
    <svg
      class="set-chevron"
      class:set-chevron--open={isOpen}
      aria-hidden="true"
      fill="currentColor"
      height="18"
      viewBox="0 -960 960 960"
      width="18"
    >
      <path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z" />
    </svg>
  </div>
</button>
{#if isOpen}
  <div
    bind:this={elList}
    class="dropdown-list"
    onkeydown={handleListKeydown}
    role="menu"
    tabindex="-1"
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
          <svg aria-hidden="true" fill="currentColor" height="18" viewBox="0 -960 960 960" width="18">
            <path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z" />
          </svg>
        {/if}
      </button>
    {/each}
  </div>
{/if}

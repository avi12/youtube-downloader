<script lang="ts" module>
  let selectInstanceCounter = 0;
</script>

<script lang="ts">
  import { attachIcon } from "@/lib/ui/polymer-utils";
  import type { LabeledOption } from "@/types";
  import { YtIconName } from "@/types";
  import { untrack } from "svelte";

  interface Props {
    id?: string;
    label: string;
    options: ReadonlyArray<LabeledOption>;
    value: string;
    disabled?: boolean;
    onchange: (value: string) => void;
  }

  const { id, label, options, value, disabled = false, onchange }: Props = $props();

  const suffix = untrack(() => {
    if (id) {
      return id;
    }

    return String(++selectInstanceCounter);
  });
  const anchorName = `--ytdl-select-${suffix}`;
  const popoverId = `ytdl-select-popup-${suffix}`;

  const selectedLabel = $derived(options.find(option => option.value === value)?.label ?? "");

  let isOpen = $state(false);
  let elTrigger: HTMLElement | null = null;
  let elPopover: HTMLElement | null = null;
  let elMenu: HTMLElement | null = null;

  function focusTrigger() {
    elTrigger?.focus();
  }

  function attachTrigger(elTarget: Element) {
    if (!(elTarget instanceof HTMLElement)) {
      return;
    }

    elTrigger = elTarget;

    function handleClick(e: Event) {
      e.stopPropagation();
    }

    function handleKeydown(e: Event) {
      if (!(e instanceof KeyboardEvent) || e.key !== "ArrowDown") {
        return;
      }

      e.preventDefault();
      elPopover?.showPopover();
    }

    elTarget.addEventListener("click", handleClick);
    elTarget.addEventListener("keydown", handleKeydown);
    return () => {
      elTarget.removeEventListener("click", handleClick);
      elTarget.removeEventListener("keydown", handleKeydown);
    };
  }

  function attachPopover(elTarget: Element) {
    if (!(elTarget instanceof HTMLElement)) {
      return;
    }

    elPopover = elTarget;

    function handleToggle(e: Event) {
      if (!(e instanceof ToggleEvent)) {
        return;
      }

      isOpen = e.newState === "open";

      if (e.newState === "open") {
        const triggerBottom = elTrigger?.getBoundingClientRect().bottom ?? 0;
        elPopover?.style.setProperty("--ytdl-popup-max-height", `${innerHeight - triggerBottom - 12}px`);
        requestAnimationFrame(() => elMenu?.focus());
      } else {
        focusTrigger();
      }
    }

    elTarget.addEventListener("toggle", handleToggle);
    return () => elTarget.removeEventListener("toggle", handleToggle);
  }

  function attachMenu(elTarget: Element) {
    if (!(elTarget instanceof HTMLElement)) {
      return;
    }

    elMenu = elTarget;

    function handleClick(e: Event) {
      if (!(e.target instanceof Element)) {
        return;
      }

      const elItem = e.target.closest("tp-yt-paper-item");
      if (!elItem) {
        return;
      }

      const dataValue = elItem.getAttribute("data-value");
      if (!dataValue) {
        return;
      }

      if (dataValue !== value) {
        onchange(dataValue);
      }

      elPopover?.hidePopover();
    }

    function handleKeydown(e: Event) {
      if (!(e instanceof KeyboardEvent)) {
        return;
      }

      if (e.key === "Escape") {
        e.stopPropagation();
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        elPopover?.hidePopover();
        return;
      }

      if (e.key === "Enter" || e.key === " ") {
        const elActive = document.activeElement;
        if (!(elActive instanceof HTMLElement) || !elActive.matches("tp-yt-paper-item")) {
          return;
        }

        e.preventDefault();
        const dataValue = elActive.getAttribute("data-value");
        if (!dataValue) {
          return;
        }

        if (dataValue !== value) {
          onchange(dataValue);
        }

        elPopover?.hidePopover();
      }
    }

    elTarget.addEventListener("click", handleClick);
    elTarget.addEventListener("keydown", handleKeydown);
    return () => {
      elTarget.removeEventListener("click", handleClick);
      elTarget.removeEventListener("keydown", handleKeydown);
    };
  }
</script>

<div class="ytdl-select-field">
  <label class="ytdl-select-label" for={id}>{label}</label>
  <button
    {id}
    style="anchor-name: {anchorName};"
    class="ytdl-select-trigger"
    class:open={isOpen}
    {@attach attachTrigger}
    aria-expanded={isOpen}
    aria-haspopup="listbox"
    aria-label={label}
    disabled={disabled || undefined}
    popovertarget={popoverId}
    popovertargetaction="toggle"
    type="button"
  >
    <span class="value">{selectedLabel}</span>
    <yt-icon class="chevron" class:open={isOpen} {@attach attachIcon(YtIconName.ExpandMore)}></yt-icon>
  </button>

  <div
    id={popoverId}
    style="position-anchor: {anchorName};"
    class="ytdl-select-popup"
    {@attach attachPopover}
    popover="auto"
  >
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
  </div>
</div>

<style>
  .ytdl-select-field {
    &:has(.ytdl-select-trigger:disabled) {
      opacity: var(--paper-dropdown-menu-disabled-opacity, 33%);
    }
  }

  .ytdl-select-label {
    display: block;
    margin-block-end: 6px;
    color: var(--yt-sys-color-baseline--text-secondary, #606060);
    font-weight: 500;
    font-size: 1.2rem;
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
    border: 1px solid var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 16%));
    border-radius: 8px;
    background: transparent;
    color: var(--yt-sys-color-baseline--text-primary, #0f0f0f);
    font: inherit;
    font-size: 1.4rem;
    text-align: start;
    cursor: pointer;

    &:hover {
      border-color: var(--yt-sys-color-baseline--text-secondary, #606060);
    }

    &.open {
      border-color: var(--yt-sys-color-baseline--call-to-action, #065fd4);
    }

    &:disabled {
      cursor: default;
    }

    .value {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .chevron {
      flex-shrink: 0;
      width: 18px;
      height: 18px;
      margin-inline-start: 8px;
      color: var(--yt-sys-color-baseline--text-secondary, #606060);
      transition: rotate 120ms ease-out;

      &.open {
        rotate: 180deg;
      }
    }
  }

  .ytdl-select-popup {
    position: fixed;
    top: anchor(bottom);
    left: anchor(left);
    overflow-y: auto;
    min-width: anchor-size(width);
    max-height: var(--ytdl-popup-max-height, 60dvh);
    margin-block-start: 4px;
    padding: 4px;
    border: 1px solid var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 10%));
    border-radius: 8px;
    background: var(--yt-sys-color-baseline--raised-background, var(--yt-sys-color-baseline--base-background, #ffffff));
    scrollbar-width: thin;
    box-shadow: 0 8px 32px rgb(0 0 0 / 32%), 0 2px 8px rgb(0 0 0 / 16%);
  }

  :global(.ytdl-select-menu tp-yt-paper-item) {
    display: flex;
    align-items: center;
    min-height: 0;
    padding: 8px 10px;
    border-radius: 6px;
    color: var(--yt-sys-color-baseline--text-primary, #0f0f0f);
    font-size: 1.4rem;
    white-space: nowrap;
    cursor: pointer;
  }

  :global(.ytdl-select-menu tp-yt-paper-item:hover) {
    background-color: var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 6%));
  }

  :global(.ytdl-select-menu tp-yt-paper-item[aria-selected="true"]) {
    font-weight: 500;
  }
</style>

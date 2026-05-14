<script lang="ts">
  import { attachIcon } from "@/lib/ui/polymer-utils";
  import type { LabeledOption, TpYtIronDropdownElement } from "@/types";
  import { YtIconName } from "@/types";

  interface Props {
    id?: string;
    label: string;
    options: ReadonlyArray<LabeledOption>;
    value: string;
    disabled?: boolean;
    onchange: (value: string) => void;
  }

  const { id, label, options, value, disabled = false, onchange }: Props = $props();

  const selectedLabel = $derived(options.find(option => option.value === value)?.label ?? "");

  function isTpYtIronDropdown(elTarget: Element): elTarget is TpYtIronDropdownElement {
    return elTarget instanceof HTMLElement && "open" in elTarget && "positionTarget" in elTarget;
  }

  let isOpen = $state(false);
  let elTrigger = $state<HTMLElement | null>(null);
  let elDropdown = $state<TpYtIronDropdownElement | null>(null);
  let elMenu = $state<HTMLElement | null>(null);

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

  function attachDropdown(elTarget: Element) {
    if (!isTpYtIronDropdown(elTarget)) {
      return;
    }

    elDropdown = elTarget;
    elTarget.positionTarget = elTrigger;
    elTarget.fitInto = window;
    elTarget.dynamicAlign = true;

    function handleOverlayClosed() {
      isOpen = false;
      focusTrigger();
    }

    elTarget.addEventListener("iron-overlay-closed", handleOverlayClosed);
    return () => elTarget.removeEventListener("iron-overlay-closed", handleOverlayClosed);
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
      focusTrigger();
    }

    function handleKeydown(e: Event) {
      if (!(e instanceof KeyboardEvent)) {
        return;
      }

      if (e.key === "Escape" || e.key === "Tab") {
        if (e.key === "Escape") {
          e.preventDefault();
        }

        isOpen = false;
        focusTrigger();
        return;
      }

      if (e.key === "Enter" || e.key === " ") {
        const elActive = document.activeElement;
        if (elActive instanceof HTMLElement && elActive.matches("tp-yt-paper-item")) {
          const dataValue = elActive.getAttribute("data-value");
          if (dataValue === value) {
            e.preventDefault();
            isOpen = false;
            focusTrigger();
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

  $effect(() => {
    if (!elDropdown) {
      return;
    }

    if (isOpen) {
      elDropdown.open();
      requestAnimationFrame(() => elMenu?.focus());
    } else {
      elDropdown.close();
    }
  });
</script>

<div class="ytdl-select-field">
  <label class="ytdl-select-label" for={id}>{label}</label>
  <button
    {id}
    class="ytdl-select-trigger"
    class:open={isOpen}
    {@attach attachTrigger}
    aria-expanded={isOpen}
    aria-haspopup="listbox"
    aria-label={label}
    disabled={disabled || undefined}
    type="button"
  >
    <span class="value">{selectedLabel}</span>
    <yt-icon class="chevron" class:open={isOpen} {@attach attachIcon(YtIconName.ExpandMore)}></yt-icon>
  </button>

  <tp-yt-iron-dropdown
    {@attach attachDropdown}
    no-cancel-on-esc-key
  >
    <tp-yt-paper-listbox
      slot="dropdown-content"
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
  </tp-yt-iron-dropdown>
</div>

<style>
  .ytdl-select-field {
    position: relative;

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

  :global(.ytdl-select-menu) {
    overflow-y: auto;
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

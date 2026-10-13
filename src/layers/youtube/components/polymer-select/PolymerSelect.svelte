<script lang="ts" module>
  let selectInstanceCounter = 0;
</script>

<script lang="ts">
  import { attachIcon } from "@/lib/ui/polymer-utils";
  import { formatChoiceLabel, type Choice } from "@/lib/utils/choices";
  import { YtIconName } from "@/types";
  import { untrack } from "svelte";

  interface Props {
    id?: string;
    label: string;
    options: ReadonlyArray<Choice>;
    value: string;
    disabled?: boolean;
    onchange: (value: string) => void;
  }

  const { id, label, options, value, disabled = false, onchange }: Props = $props();

  const ANCHOR_NAME_PREFIX = "--ytdl-select-";
  const POPOVER_ID_PREFIX = "ytdl-select-popup-";
  const POLYMER_PAPER_ITEM = "tp-yt-paper-item";
  const POLYMER_IRON_DROPDOWN_SELECTOR = "tp-yt-iron-dropdown";
  const DATA_VALUE_ATTR = "data-value";
  const POPOVER_OPEN_STATE = "open";
  const POPUP_MARGIN_TOP = 4;
  const POPUP_BOTTOM_GAP = 8;
  const POPUP_MIN_HEIGHT = 120;

  const suffix = untrack(() => {
    if (id) {
      return id;
    }

    return String(++selectInstanceCounter);
  });
  const anchorName = `${ANCHOR_NAME_PREFIX}${suffix}`;
  const popoverId = `${POPOVER_ID_PREFIX}${suffix}`;

  const selectedOption = $derived(options.find(option => option.value === value));
  const selectedLabel = $derived(selectedOption ? formatChoiceLabel(selectedOption) : "");

  let isOpen = $state(false);
  let elTrigger: HTMLElement | null = null;
  let elPopover: HTMLElement | null = null;
  let elMenu: HTMLElement | null = null;

  function focusTrigger(): void {
    elTrigger?.focus();
  }

  function attachTrigger(elTarget: Element): (() => void) | void {
    const isHtmlElement = elTarget instanceof HTMLElement;
    if (!isHtmlElement) {
      return;
    }

    elTrigger = elTarget;

    function handleClick(e: Event): void {
      e.stopPropagation();
    }

    function handleKeydown(e: Event): void {
      const isKeyboardEvent = e instanceof KeyboardEvent;
      const isArrowDown = isKeyboardEvent && e.key === "ArrowDown";
      if (!isArrowDown) {
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

  function attachPopover(elTarget: Element): (() => void) | void {
    const isHtmlElement = elTarget instanceof HTMLElement;
    if (!isHtmlElement) {
      return;
    }

    elPopover = elTarget;

    type IronDropdownElement = HTMLElement & { noCancelOnEscKey?: boolean };
    const elIronDropdown = elTarget.closest<IronDropdownElement>(POLYMER_IRON_DROPDOWN_SELECTOR);

    function openPopup(): void {
      if (elTrigger) {
        const { bottom } = elTrigger.getBoundingClientRect();
        const availableHeight = innerHeight - bottom - POPUP_MARGIN_TOP - POPUP_BOTTOM_GAP;
        elPopover?.style.setProperty("--ytdl-popup-max-height", `${Math.max(POPUP_MIN_HEIGHT, availableHeight)}px`);
      }

      if (elIronDropdown) {
        elIronDropdown.noCancelOnEscKey = true;
      }

      requestAnimationFrame(() => elMenu?.focus());
    }

    function closePopup(): void {
      if (elIronDropdown) {
        elIronDropdown.noCancelOnEscKey = false;
      }

      focusTrigger();
    }

    function handleToggle(e: Event): void {
      if (!(e instanceof ToggleEvent)) {
        return;
      }

      const isOpening = e.newState === POPOVER_OPEN_STATE;
      isOpen = isOpening;

      if (isOpening) {
        openPopup();
      } else {
        closePopup();
      }
    }

    elTarget.addEventListener("toggle", handleToggle);
    return () => elTarget.removeEventListener("toggle", handleToggle);
  }

  function attachMenu(elTarget: Element): (() => void) | void {
    const isHtmlElement = elTarget instanceof HTMLElement;
    if (!isHtmlElement) {
      return;
    }

    elMenu = elTarget;

    const itemsObserver = new MutationObserver(() => {
      elTarget.style.removeProperty("height");
    });
    itemsObserver.observe(elTarget, { childList: true });

    function handleMousedown(e: Event): void {
      e.preventDefault();
    }

    function selectItem(elItem: Element): void {
      if (elItem.getAttribute("aria-disabled") === "true") {
        return;
      }

      const dataValue = elItem.getAttribute(DATA_VALUE_ATTR);
      if (!dataValue) {
        return;
      }

      if (dataValue !== value) {
        onchange(dataValue);
      }

      elPopover?.hidePopover();
    }

    function handleClick(e: Event): void {
      if (!(e.target instanceof Element)) {
        return;
      }

      const elItem = e.target.closest(POLYMER_PAPER_ITEM);
      if (!elItem) {
        return;
      }

      selectItem(elItem);
    }

    function handleConfirmKey(e: KeyboardEvent): void {
      const elActive = document.activeElement;
      if (!(elActive instanceof HTMLElement) || !elActive.matches(POLYMER_PAPER_ITEM)) {
        return;
      }

      e.preventDefault();
      selectItem(elActive);
    }

    function handleEscapeKey(e: KeyboardEvent): void {
      e.stopPropagation();
    }

    function handleTabKey(e: KeyboardEvent): void {
      e.preventDefault();
      elPopover?.hidePopover();
    }

    function handleKeydown(e: Event): void {
      if (!(e instanceof KeyboardEvent)) {
        return;
      }

      const keyHandlers: Partial<Record<string, (e: KeyboardEvent) => void>> = {
        Escape: handleEscapeKey,
        Tab: handleTabKey,
        Enter: handleConfirmKey,
        " ": handleConfirmKey
      };
      keyHandlers[e.key]?.(e);
    }

    elTarget.addEventListener("mousedown", handleMousedown);
    elTarget.addEventListener("click", handleClick);
    elTarget.addEventListener("keydown", handleKeydown);
    return () => {
      itemsObserver.disconnect();
      elTarget.removeEventListener("mousedown", handleMousedown);
      elTarget.removeEventListener("click", handleClick);
      elTarget.removeEventListener("keydown", handleKeydown);
    };
  }
</script>

<div class="ytdl-select-field">
  <label class="ytdl-select-label" for={id}>{label}</label>
  <button
    {id}
    style:anchor-name={anchorName}
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
    style:position-anchor={anchorName}
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
      selectable={POLYMER_PAPER_ITEM}
      selected={value}
    >
      {#each options as option, i (option.value)}
        {#if option.group && option.group.label !== options[i - 1]?.group?.label}
          <div class="ytdl-select-group" role="presentation">
            <span class="ytdl-select-group-label">{option.group.label}</span>
            {#if option.group.description}
              <span class="ytdl-select-option-description">{option.group.description}</span>
            {/if}
          </div>
        {/if}
        <tp-yt-paper-item
          aria-disabled={option.disabled ? "true" : undefined}
          aria-label={option.group ? formatChoiceLabel(option) : undefined}
          aria-selected={option.value === value}
          data-value={option.value}
          role="option"
          tabindex={option.value === value ? 0 : -1}
        >
          {option.label}
          {#if option.description}
            <span class="ytdl-select-option-description">{option.description}</span>
          {/if}
        </tp-yt-paper-item>
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
    height: 47px;
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
    max-height: var(--ytdl-popup-max-height, clamp(120px, 50dvh, calc(100dvh - 16px)));
    margin-block-start: 4px;
    padding: 4px;
    border: 1px solid var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 10%));
    border-radius: 8px;
    background: var(--yt-sys-color-baseline--raised-background, var(--yt-sys-color-baseline--base-background, #ffffff));
    scrollbar-width: thin;
    box-shadow: 0 8px 32px rgb(0 0 0 / 32%), 0 2px 8px rgb(0 0 0 / 16%);
  }

  :global(.ytdl-select-menu) {
    height: auto !important;
    min-height: 0 !important;
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

  :global(.ytdl-select-menu tp-yt-paper-item:hover:not([aria-disabled="true"])) {
    background-color: var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 6%));
  }

  :global(.ytdl-select-menu tp-yt-paper-item[aria-disabled="true"]) {
    opacity: 38%;
    cursor: default;
  }

  :global(.ytdl-select-menu tp-yt-paper-item[aria-selected="true"]) {
    font-weight: 500;
  }

  :global(.ytdl-select-menu tp-yt-paper-item:has(.ytdl-select-option-description)) {
    flex-direction: column;
    gap: 2px;
    align-items: flex-start;
  }

  :global(.ytdl-select-group) {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-block: 10px 4px;
    padding-inline: 10px;

    &:not(:first-child) {
      margin-top: 4px;
      border-top: 1px solid var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 10%));
    }
  }

  :global(.ytdl-select-group-label) {
    color: var(--yt-sys-color-baseline--text-primary, #0f0f0f);
    font-weight: 500;
    font-size: 1.3rem;
  }

  :global(.ytdl-select-option-description) {
    color: var(--yt-sys-color-baseline--text-secondary, #606060);
    font-weight: 400;
    font-size: 1.2rem;
  }
</style>

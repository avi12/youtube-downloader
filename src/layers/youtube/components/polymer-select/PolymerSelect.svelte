<script lang="ts" module>
  import { z } from "@/lib/zod";
  import { createGuard } from "@/lib/zod-guard";

  let selectInstanceCounter = 0;

  const isEscKeyHost = createGuard(z.object({ noCancelOnEscKey: z.boolean().optional() }));
</script>

<script lang="ts">
  import { isElement, isHtmlElement, isKeyboardEvent, isToggleEvent } from "@/lib/dom-guards";
  import { attachIcon } from "@/lib/ui/polymer-utils";
  import { type Choice, formatChoiceLabel } from "@/lib/utils/choices";
  import { YtIconName } from "@/types";
  import { untrack } from "svelte";

  interface Props {
    id?: string;
    label: string;
    options: readonly Choice[];
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
  const ANCHOR_NAME = `${ANCHOR_NAME_PREFIX}${suffix}`;
  const POPOVER_ID = `${POPOVER_ID_PREFIX}${suffix}`;

  const selectedOption = $derived(options.find(option => option.value === value));
  const selectedLabel = $derived(selectedOption ? formatChoiceLabel(selectedOption) : "");

  let isOpen = $state(false);
  let elTrigger: HTMLElement | null = null;
  let elPopover: HTMLElement | null = null;
  let elMenu: HTMLElement | null = null;

  function focusTrigger() {
    elTrigger?.focus();
  }

  function attachTrigger(elTarget: Element) {
    if (!isHtmlElement(elTarget)) {
      return;
    }

    elTrigger = elTarget;

    function handleClick(event: Event) {
      event.stopPropagation();
    }

    function handleKeydown(event: Event) {
      const isArrowDown = isKeyboardEvent(event) && event.key === "ArrowDown";
      if (!isArrowDown) {
        return;
      }

      event.preventDefault();
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
    if (!isHtmlElement(elTarget)) {
      return;
    }

    elPopover = elTarget;

    const elClosestDropdown = elTarget.closest(POLYMER_IRON_DROPDOWN_SELECTOR);
    const elIronDropdown = isEscKeyHost(elClosestDropdown) ? elClosestDropdown : null;

    function openPopup() {
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

    function closePopup() {
      if (elIronDropdown) {
        elIronDropdown.noCancelOnEscKey = false;
      }

      focusTrigger();
    }

    function handleToggle(event: Event) {
      if (!isToggleEvent(event)) {
        return;
      }

      const isOpening = event.newState === POPOVER_OPEN_STATE;
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

  function attachMenu(elTarget: Element) {
    if (!isHtmlElement(elTarget)) {
      return;
    }

    elMenu = elTarget;

    const itemsObserver = new MutationObserver(() => {
      elTarget.style.removeProperty("height");
    });
    itemsObserver.observe(elTarget, { childList: true });

    function handleMousedown(event: Event) {
      event.preventDefault();
    }

    function selectItem(elItem: Element) {
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

    function handleClick(event: Event) {
      if (!(isElement(event.target))) {
        return;
      }

      const elItem = event.target.closest(POLYMER_PAPER_ITEM);
      if (!elItem) {
        return;
      }

      selectItem(elItem);
    }

    function handleConfirmKey(event: KeyboardEvent) {
      const elActive = document.activeElement;
      const isNotPaperItem = !isHtmlElement(elActive) || !elActive.matches(POLYMER_PAPER_ITEM);
      if (isNotPaperItem) {
        return;
      }

      event.preventDefault();
      selectItem(elActive);
    }

    function handleEscapeKey(event: KeyboardEvent) {
      event.stopPropagation();
    }

    function handleTabKey(event: KeyboardEvent) {
      event.preventDefault();
      elPopover?.hidePopover();
    }

    function handleKeydown(event: Event) {
      if (!isKeyboardEvent(event)) {
        return;
      }

      const keyHandlers: Partial<Record<string, (event: KeyboardEvent) => void>> = {
        Escape: handleEscapeKey,
        Tab: handleTabKey,
        Enter: handleConfirmKey,
        " ": handleConfirmKey
      };
      keyHandlers[event.key]?.(event);
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
    style:anchor-name={ANCHOR_NAME}
    class="ytdl-select-trigger"
    class:open={isOpen}
    {@attach attachTrigger}
    aria-expanded={isOpen}
    aria-haspopup="listbox"
    aria-label={label}
    disabled={disabled || undefined}
    popovertarget={POPOVER_ID}
    popovertargetaction="toggle"
    type="button"
  >
    <span class="value">{selectedLabel}</span>
    <yt-icon class="chevron" class:open={isOpen} {@attach attachIcon(YtIconName.ExpandMore)}></yt-icon>
  </button>

  <div
    id={POPOVER_ID}
    style:position-anchor={ANCHOR_NAME}
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
      opacity: var(--paper-dropdown-menu-disabled-opacity, 0.33);
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
    border: 1px solid var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 0.16));
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
    --ytdl-popup-padding: 4px;
    --ytdl-popup-background:
      var(
        --yt-sys-color-baseline--raised-background,
        var(--yt-sys-color-baseline--base-background, #ffffff)
      );

    position: fixed;
    top: anchor(bottom);
    left: anchor(left);
    overflow-y: auto;
    min-width: anchor-size(width);
    max-height: var(--ytdl-popup-max-height, clamp(120px, 50dvh, calc(100dvh - 16px)));
    margin-block-start: 4px;
    padding: var(--ytdl-popup-padding);
    border: 1px solid var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 0.1));
    border-radius: 8px;
    background: var(--ytdl-popup-background);
    scrollbar-width: thin;
    box-shadow: 0 8px 32px rgb(0 0 0 / 0.32), 0 2px 8px rgb(0 0 0 / 0.16);
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
    background-color: var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 0.06));
  }

  :global(.ytdl-select-menu tp-yt-paper-item[aria-disabled="true"]) {
    opacity: 0.38;
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

  /* Stays pinned while its rows scroll by; the next header, later in the DOM, slides over it.
     Pulled up over the popup's padding so rows don't peek above it */
  :global(.ytdl-select-group) {
    position: sticky;
    top: calc(-1 * var(--ytdl-popup-padding));
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-block: 10px 4px;
    padding-inline: 10px;
    background: var(--ytdl-popup-background);

    &:not(:first-child) {
      margin-top: 4px;
      border-top: 1px solid var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 0.1));
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

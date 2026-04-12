<script lang="ts">
  import selectDropdownStyles from "./select-dropdown.css?inline";
  import { applyPolymerCustomStyles, PAPER_INPUT_THEME } from "@/lib/polymer-utils";

  type Option = {
    value: string;
    label: string;
  };

  type Props = {
    id?: string;
    label: string;
    options: Option[];
    value: string;
    disabled?: boolean;
    onchange: (value: string) => void;
  };

  const {
    id, label, options, value, disabled = false, onchange
  }: Props = $props();

  function attachDropdown(elTarget: Element) {
    applyPolymerCustomStyles(elTarget, PAPER_INPUT_THEME);

    let elMovedDropdown: Element | null = null;
    let elChevronInput: HTMLElement | null = null;

    function onChevronFocus() {
      const elTrigger = elTarget.querySelector<HTMLElement>("tp-yt-paper-input");
      elTrigger?.focus();
    }

    // YouTube's ytd-popup-container has CSS transforms, which makes
    // position:fixed inside it behave like position:absolute - causing
    // overflow scrollbars in the panel. Move the iron-dropdown to
    // document.body BEFORE it opens to escape the transform context
    // and avoid the visible flicker.
    requestAnimationFrame(() => {
      const elIronDropdown = elTarget.querySelector("tp-yt-iron-dropdown");
      if (!elIronDropdown) {
        return;
      }

      elMovedDropdown = elIronDropdown;
      document.body.append(elIronDropdown);
      elIronDropdown.dataset.ytdlMoved = "";

      // The native input[role="button"] (the chevron arrow inside tp-yt-paper-input)
      // is a Polymer internal detail. tp-yt-paper-input is already the tab stop,
      // so this duplicate unlabeled element should not be in the tab order.
      // Polymer may reset tabindex after value changes, so we also redirect focus
      // via a listener to ensure Enter always opens the dropdown from the proper trigger.
      elChevronInput = elTarget.querySelector<HTMLElement>("input[role=\"button\"]");
      elChevronInput?.setAttribute("tabindex", "-1");
      elChevronInput?.addEventListener("focus", onChevronFocus);

      // Hide scrollbar and add focus style for keyboard-navigated items.
      // Focus visibility is required by WCAG 2.4.7 - YouTube's Polymer runtime
      // does not provide a focus ring on tp-yt-paper-item by default.
      if (!elIronDropdown.querySelector("[data-ytdl-style]")) {
        const elStyle = document.createElement("style");
        elStyle.dataset.ytdlStyle = "";
        elStyle.textContent = selectDropdownStyles;
        elIronDropdown.append(elStyle);
      }

      elIronDropdown.addEventListener("iron-overlay-opened", handleOverlayOpened);
      elIronDropdown.addEventListener("iron-overlay-closed", handleOverlayClosed);

      syncTriggerDisplay();
    });

    // Moving tp-yt-iron-dropdown to document.body breaks Polymer's binding
    // between the listbox's selected value and the trigger's displayed label,
    // so the trigger would show the raw data-value (e.g. itag "7206") instead
    // of the option label (e.g. "2160p 60fps"). Sync it manually.
    function syncTriggerDisplay(dataValue: string = value) {
      const selectedOption = options.find(option => option.value === dataValue);
      const elTrigger = elTarget.querySelector("tp-yt-paper-input");
      if (elTrigger instanceof HTMLElement && selectedOption) {
        Object.assign(elTrigger, { value: selectedOption.label });
      }
    }

    function handleOverlayOpened() {
      if (!elMovedDropdown) {
        return;
      }

      // Add yt-options-renderer scope for cursor:pointer and :hover.
      // role, aria-selected, and tabindex are set via HTML attributes in the template.
      for (const elItem of elMovedDropdown.querySelectorAll("tp-yt-paper-item")) {
        elItem.classList.add("style-scope", "yt-options-renderer");
      }

      const items = Array.from(elMovedDropdown.querySelectorAll<HTMLElement>("tp-yt-paper-item"));

      // WAI-ARIA Listbox pattern: focus the selected option (tabindex=0) on open.
      const elInitialFocus =
        elMovedDropdown.querySelector<HTMLElement>("tp-yt-paper-item[tabindex=\"0\"]")
        ?? items[0];
      elInitialFocus?.focus();

      // Moving tp-yt-iron-dropdown to document.body severs Polymer's data binding
      // between the listbox and tp-yt-paper-dropdown-menu. As a result, value-changed
      // never fires on the dropdown-menu after selection (for both mouse and keyboard).
      // We listen to selected-changed directly on the moved dropdown, which always
      // fires, and handle state + display update ourselves.
      function handleSelectedChanged(e: Event) {
        if (!(e instanceof CustomEvent)) {
          return;
        }

        const dataValue: string = e.detail?.value;
        if (!dataValue) {
          return;
        }

        onchange(dataValue);

        syncTriggerDisplay(dataValue);

        // Close the overlay - Polymer's auto-close is also broken by the DOM move.
        elMovedDropdown?.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
            composed: true
          })
        );
      }

      elMovedDropdown.addEventListener("selected-changed", handleSelectedChanged);

      // WAI-ARIA keyboard contract for a listbox popup:
      // Arrow Down/Up  - move focus between options (with wrap-around)
      // Home / End     - jump to first / last option
      // Enter / Space  - select focused option and close
      // Tab            - close popup and return focus to trigger
      // Escape         - handled natively by Polymer's IronOverlayBehavior
      //
      // Use capture phase so this fires before Polymer's IronMenuBehavior /
      // IronButtonState handlers, which call stopPropagation() on arrow keys and
      // Enter - preventing bubble-phase listeners on elMovedDropdown from ever running.
      function onListboxKeydown(e: Event) {
        if (!(e instanceof KeyboardEvent)) {
          return;
        }

        const elActive = document.activeElement;
        const iCurrent = elActive instanceof HTMLElement ? items.indexOf(elActive) : -1;

        switch (e.key) {
          case "ArrowDown": {
            e.preventDefault();
            e.stopPropagation();
            items[(iCurrent + 1) % items.length]?.focus();
            break;
          }
          case "ArrowUp": {
            e.preventDefault();
            e.stopPropagation();
            items[(iCurrent - 1 + items.length) % items.length]?.focus();
            break;
          }
          case "Home": {
            e.preventDefault();
            e.stopPropagation();
            items[0]?.focus();
            break;
          }
          case "End": {
            e.preventDefault();
            e.stopPropagation();
            items[items.length - 1]?.focus();
            break;
          }
          case "Enter":
          case " ": {
            e.preventDefault();
            e.stopPropagation();

            if (iCurrent >= 0) {
              items[iCurrent].click();

              // If the focused item is already selected, selected-changed will not
              // fire (value unchanged). Close the overlay directly in that case.
              if (items[iCurrent].getAttribute("data-value") === value) {
                elMovedDropdown?.dispatchEvent(
                  new KeyboardEvent("keydown", {
                    key: "Escape",
                    bubbles: true,
                    cancelable: true,
                    composed: true
                  })
                );
              }
            }

            break;
          }
          case "Tab": {
            // Prevent Tab from escaping to the browser chrome while the popup is
            // open. Close via synthetic Escape; handleOverlayClosed returns focus
            // to the trigger so the user can continue tabbing through the panel.
            e.preventDefault();
            e.stopPropagation();
            elMovedDropdown?.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "Escape",
                bubbles: true,
                cancelable: true,
                composed: true
              })
            );
            break;
          }
        }
      }

      elMovedDropdown.addEventListener("keydown", onListboxKeydown, true);
      elMovedDropdown.addEventListener(
        "iron-overlay-closed",
        () => {
          elMovedDropdown?.removeEventListener("selected-changed", handleSelectedChanged);
          elMovedDropdown?.removeEventListener("keydown", onListboxKeydown, true);
        },
        { once: true }
      );
    }

    // Return focus to the dropdown trigger when the overlay closes.
    // requestAnimationFrame defers past any post-close focus management Polymer
    // runs synchronously (e.g. _applyFocus), so our call always wins.
    function handleOverlayClosed() {
      const elTrigger = elTarget.querySelector<HTMLElement>("tp-yt-paper-input");
      requestAnimationFrame(() => elTrigger?.focus());
    }

    return () => {
      elMovedDropdown?.removeEventListener("iron-overlay-opened", handleOverlayOpened);
      elMovedDropdown?.removeEventListener("iron-overlay-closed", handleOverlayClosed);
      elMovedDropdown?.remove();
      elChevronInput?.removeEventListener("focus", onChevronFocus);
    };
  }

  // Grab Polymer's scoping class so tp-yt-paper-dropdown-menu receives
  // identical styling to existing YouTube dropdown instances.
  const scopingClass =
    document.querySelector("yt-dropdown-menu")?.getAttribute("class") ?? "";
</script>

<tp-yt-paper-dropdown-menu
  {id}
  class={scopingClass}
  {@attach attachDropdown}
  aria-label={label}
  disabled={disabled || undefined}
  {label}
>
  <tp-yt-paper-listbox
    slot="dropdown-content"
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
</tp-yt-paper-dropdown-menu>

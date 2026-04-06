<script lang="ts">
  import { AUTO_EXTENSION_LABEL } from "../lib/utils";

  type Props = {
    id: string;
    label: string;
    options: string[];
    value: string;
    onchange: (value: string) => void;
  };

  const { id, label, options, value, onchange }: Props = $props();

  // eslint-disable-next-line svelte/prefer-writable-derived -- query is both externally synced and locally mutated
  let query = $state(formatDisplay(value));
  let isOpen = $state(false);
  let iHighlighted = $state(-1);

  const filtered = $derived(
    query
      ? options.filter(option => formatDisplay(option).toLowerCase().includes(query.toLowerCase()))
      : options
  );

  function formatDisplay(option: string) {
    return option === "auto" ? AUTO_EXTENSION_LABEL : option;
  }

  function selectOption(option: string) {
    query = formatDisplay(option);
    isOpen = false;
    iHighlighted = -1;
    onchange(option);
  }

  function handleInput(e: Event) {
    const { target } = e;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    query = target.value;
    isOpen = true;
    iHighlighted = -1;
  }

  function handleFocus() {
    isOpen = true;
  }

  function handleBlur() {
    // Delay to allow click on option to register
    setTimeout(() => {
      isOpen = false;

      // Validate: revert to current value if query doesn't match an option
      const match = options.find(option => formatDisplay(option).toLowerCase() === query.toLowerCase());
      if (match) {
        selectOption(match);
      } else {
        query = formatDisplay(value);
      }
    }, 150);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!isOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      isOpen = true;
      e.preventDefault();
      return;
    }

    if (!isOpen) {
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      iHighlighted = Math.min(iHighlighted + 1, filtered.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      iHighlighted = Math.max(iHighlighted - 1, 0);
    } else if (e.key === "Enter") {
      e.preventDefault();

      if (iHighlighted >= 0 && filtered[iHighlighted]) {
        selectOption(filtered[iHighlighted]);
      }
    } else if (e.key === "Escape") {
      isOpen = false;
      query = formatDisplay(value);
    }
  }

  // Keep query in sync when value changes externally
  $effect(() => {
    query = formatDisplay(value);
  });
</script>

<div class="autocomplete">
  <label class="autocomplete-label" for={id}>{label}</label>
  <div class="autocomplete-wrapper">
    <input
      {id}
      class="autocomplete-input"
      aria-activedescendant={iHighlighted >= 0 ? `${id}-option-${iHighlighted}` : undefined}
      aria-autocomplete="list"
      aria-controls="{id}-listbox"
      aria-expanded={isOpen && filtered.length > 0}
      autocomplete="off"
      onblur={handleBlur}
      onfocus={handleFocus}
      oninput={handleInput}
      onkeydown={handleKeydown}
      role="combobox"
      type="text"
      value={query}
    />
    {#if isOpen && filtered.length > 0}
      <ul
        id="{id}-listbox"
        class="autocomplete-listbox"
        role="listbox"
      >
        {#each filtered as option, index (option)}
          <li
            id="{id}-option-{index}"
            class="autocomplete-option"
            class:autocomplete-option--highlighted={index === iHighlighted}
            aria-selected={option === value}
            onmousedown={() => selectOption(option)}
            role="option"
          >
            {formatDisplay(option)}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .autocomplete {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .autocomplete-label {
    flex: 1;
    font-size: 1.3rem;
  }

  .autocomplete-wrapper {
    position: relative;
  }

  .autocomplete-input {
    width: 140px;
    padding: 4px 8px;
    border: 1px solid rgb(0 0 0 / 20%);
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font-family: inherit;
    font-size: 1.3rem;
  }

  .autocomplete-input:focus-visible {
    outline: 2px solid rgb(6 95 212);
    outline-offset: -1px;
  }

  @media (prefers-color-scheme: dark) {
    .autocomplete-input {
      border-color: rgb(255 255 255 / 20%);
    }
  }

  .autocomplete-listbox {
    position: absolute;
    right: 0;
    z-index: 10;
    overflow-y: auto;
    width: 100%;
    min-width: 160px;
    max-height: 200px;
    margin-top: 2px;
    padding: 4px 0;
    border: 1px solid rgb(0 0 0 / 15%);
    border-radius: 4px;
    background: rgb(255 255 255);
    box-shadow: 0 4px 12px rgb(0 0 0 / 15%);
    list-style: none;
  }

  @media (prefers-color-scheme: dark) {
    .autocomplete-listbox {
      border-color: rgb(255 255 255 / 15%);
      background: rgb(50 50 50);
      box-shadow: 0 4px 12px rgb(0 0 0 / 40%);
    }
  }

  .autocomplete-option {
    padding: 6px 10px;
    font-size: 1.3rem;
    cursor: pointer;
  }

  .autocomplete-option:hover,
  .autocomplete-option--highlighted {
    background: rgb(6 95 212 / 10%);
  }

  .autocomplete-option[aria-selected="true"] {
    font-weight: 600;
  }

  @media (prefers-color-scheme: dark) {
    .autocomplete-option:hover,
    .autocomplete-option--highlighted {
      background: rgb(6 95 212 / 20%);
    }
  }
</style>

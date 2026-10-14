<script generics="Value extends string" lang="ts">
  import type { Snippet } from "svelte";
  import { slide } from "svelte/transition";

  interface RadioOption {
    value: Value;
    label: string;
    description?: string;
    sub?: () => ReturnType<Snippet>;
  }

  interface Props {
    legend: string;
    isLegendHidden?: boolean;
    name: string;
    options: ReadonlyArray<RadioOption>;
    selected: Value;
    slideDuration?: number;
    onchange: (value: Value) => void;
  }

  const { legend, isLegendHidden, name, options, selected, slideDuration, onchange }: Props = $props();
</script>

<fieldset class="set-section-fieldset">
  <legend class={isLegendHidden ? "visually-hidden" : "radio-group-legend"}>{legend}</legend>
  <div class="radio-group" role="radiogroup">
    {#each options as { value, label, description, sub } (value)}
      <label class="radio-item">
        <input
          {name}
          class="radio-input-hidden"
          checked={selected === value}
          onchange={() => onchange(value)}
          type="radio"
          {value}
        />
        <div class="radio-dot"></div>
        <div class="radio-txt">
          <span class="radio-label">{label}</span>
          {#if description}
            <span class="radio-desc">{description}</span>
          {/if}
        </div>
      </label>
      {#if sub && selected === value}
        <div class="radio-sub" transition:slide={{ duration: slideDuration }}>
          {@render sub()}
        </div>
      {/if}
    {/each}
  </div>
</fieldset>

<style>
  .set-section-fieldset {
    margin: 0;
    padding: 0;
    border: none;
    border-top: 1px solid var(--border);

    &:first-child {
      border-top: none;
    }
  }

  .visually-hidden {
    position: absolute;
    overflow: hidden;
    width: 1px;
    height: 1px;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .radio-group-legend {
    padding-block: 10px 2px;
    padding-inline: 14px;
    color: var(--fg-muted);
    font-weight: 500;
    font-size: 0.75rem;
  }

  .radio-group {
    display: flex;
    flex-direction: column;
    padding: 4px;
  }

  .radio-item {
    display: flex;
    gap: 13px;
    align-items: flex-start;
    padding: 9px 10px;
    border-radius: 12px;
    cursor: pointer;

    &:hover {
      background: var(--surface-high);
    }
  }

  .radio-input-hidden {
    position: absolute;
    width: 0;
    height: 0;
    opacity: 0%;
  }

  .radio-dot {
    position: relative;
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    margin-top: 1px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 2px var(--fg-subtle);
    transition: box-shadow 150ms;

    &::after {
      content: "";
      position: absolute;
      inset: 0;
      width: 10px;
      height: 10px;
      margin: auto;
      border-radius: 50%;
      background: var(--accent);
      transition: scale 180ms cubic-bezier(0.34, 1.56, 0.64, 1);
      scale: 0;
    }

    .radio-input-hidden:checked ~ & {
      box-shadow: inset 0 0 0 2px var(--accent);

      &::after {
        scale: 1;
      }
    }

    .radio-item:has(.radio-input-hidden:focus-visible) & {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
  }

  .radio-txt {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .radio-label {
    color: var(--fg);
    font-weight: 500;
    font-size: 0.84375rem;
  }

  .radio-desc {
    color: var(--fg-muted);
    font-size: 0.71875rem;
  }

  .radio-sub {
    margin-block: -2px 4px;
    margin-inline: 22px 8px;
    padding-inline-start: 21px;
    border-inline-start: 1.5px solid var(--border);
  }
</style>

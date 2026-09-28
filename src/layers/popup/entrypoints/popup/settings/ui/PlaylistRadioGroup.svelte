<script lang="ts">
  import type { LabeledOption } from "@/types";

  interface Props {
    legend: string;
    name: string;
    options: ReadonlyArray<LabeledOption>;
    selected: string;
    onchange: (value: string) => void;
  }

  const { legend, name, options, selected, onchange }: Props = $props();
</script>

<fieldset class="set-section-fieldset">
  <legend class="radio-group-legend">{legend}</legend>
  <div class="radio-group">
    {#each options as { value, label } (value)}
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
        </div>
      </label>
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
    min-inline-size: auto;
    margin: 0;
    padding: 4px;
    border: none;
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
      transition: transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1);
      transform: scale(0);
    }
  }

  .radio-input-hidden:checked ~ .radio-dot {
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  .radio-input-hidden:checked ~ .radio-dot::after {
    transform: scale(1);
  }

  .radio-item:has(.radio-input-hidden:focus-visible) .radio-dot {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
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
</style>

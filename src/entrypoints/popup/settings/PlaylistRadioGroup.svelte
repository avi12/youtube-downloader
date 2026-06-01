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

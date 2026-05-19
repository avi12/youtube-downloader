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

<fieldset class="settings-format-section">
  <legend class="settings-sub-legend">{legend}</legend>
  {#each options as { value, label } (value)}
    <div class="settings-row">
      <label class="settings-label settings-radio-label">
        <input
          {name}
          checked={selected === value}
          onchange={() => onchange(value)}
          type="radio"
          {value}
        />
        {label}
      </label>
    </div>
  {/each}
</fieldset>

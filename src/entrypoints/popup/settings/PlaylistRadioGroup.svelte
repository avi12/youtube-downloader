<script lang="ts">
  interface Props {
    legend: string;
    name: string;
    options: Array<{
      value: string;
      label: string;
    }>;
    selected: string;
    onchange: (value: string) => void;
  }

  const { legend, name, options, selected, onchange }: Props = $props();
</script>

<div class="settings-format-section">
  <span class="settings-sub-legend">{legend}</span>
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
</div>

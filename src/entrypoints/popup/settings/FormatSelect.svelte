<script lang="ts">
  import { AUTO_EXTENSION, AUTO_EXTENSION_LABEL, getFormatDescription } from "@/lib/utils/containers";

  interface Props {
    label?: string;
    options: string[];
    value: string;
    onchange: (value: string) => void;
  }

  const { label, options, value, onchange }: Props = $props();
  const id = $props.id();
</script>

<div class="format-select">
  {#if label}
    <label class="format-select-label" for={id}>{label}</label>
  {/if}
  <select
    {id}
    class="format-select-control"
    onchange={e => {
      const isSelectElement = e.target instanceof HTMLSelectElement;
      if (!isSelectElement) {
        return;
      }

      onchange(e.target.value);
    }}
    {value}
  >
    {#each options as option (option)}
      <option selected={option === value} value={option}>
        {option === AUTO_EXTENSION ? AUTO_EXTENSION_LABEL : `${option} - ${getFormatDescription(option)}`}
      </option>
    {/each}
  </select>
</div>

<style>
  .format-select {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .format-select-label {
    flex: 1;
    font-size: 0.8125rem;
  }

  .format-select-control {
    flex: 1;
    min-width: 150px;
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg, transparent);
    color: var(--fg, inherit);
    font-family: inherit;
    font-size: 0.8125rem;
    cursor: pointer;

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
  }
</style>

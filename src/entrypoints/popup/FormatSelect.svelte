<script lang="ts">
  import { AUTO_EXTENSION, AUTO_EXTENSION_LABEL } from "@/lib/utils";

  type Props = {
    id: string;
    label: string;
    options: string[];
    value: string;
    onchange: (value: string) => void;
  };

  const { id, label, options, value, onchange }: Props = $props();

</script>

<div class="format-select">
  <label class="format-select-label" for={id}>{label}</label>
  <select
    {id}
    class="format-select-control"
    onchange={e => {
      if (e.target instanceof HTMLSelectElement) {
        onchange(e.target.value);
      }
    }}
    {value}
  >
    {#each options as option (option)}
      <option selected={option === value} value={option}>
        {option === AUTO_EXTENSION ? AUTO_EXTENSION_LABEL : option}
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

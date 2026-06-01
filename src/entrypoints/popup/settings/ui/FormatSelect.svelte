<script lang="ts">
  import { AUTO_EXTENSION, AUTO_EXTENSION_LABEL } from "@/lib/utils/containers";
  import type { FormatItem } from "@/lib/utils/containers";

  interface Props {
    label?: string;
    items: Pick<FormatItem, "extension" | "description">[];
    value: string;
    onchange: (value: string) => void;
  }

  const { label, items, value, onchange }: Props = $props();
  const id = $props.id();

  function formatLabel(item: Pick<FormatItem, "extension" | "description">): string {
    if (item.extension === AUTO_EXTENSION) {
      return AUTO_EXTENSION_LABEL;
    }

    return item.description ? `${item.extension} - ${item.description}` : item.extension;
  }
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
    {#each items as item (item.extension)}
      <option selected={item.extension === value} value={item.extension}>
        {formatLabel(item)}
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

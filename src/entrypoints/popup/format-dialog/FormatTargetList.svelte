<script lang="ts">
  interface Props {
    targets: string[];
    selectedTarget: string;
    estimatedTimeLabel: string;
    onSelect: (target: string) => void;
  }

  const { targets, selectedTarget, estimatedTimeLabel, onSelect }: Props = $props();
</script>

{#if targets.length === 0}
  <p class="dialog-note">No alternative formats available for this file</p>
{:else}
  <div class="target-list" aria-label="Target format" role="radiogroup">
    {#each targets as target (target)}
      <label class="target-option">
        <input
          name="target-format"
          checked={selectedTarget === target}
          onchange={() => onSelect(target)}
          type="radio"
          value={target}
        />
        <span>{target}</span>
      </label>
    {/each}
  </div>

  <p class="dialog-note">
    Transcoding takes {estimatedTimeLabel}. The download will restart with the new format
  </p>
{/if}

<style>
  .target-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .target-option {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--fg);
    font-size: 0.8125rem;
    cursor: pointer;
    transition: background-color 150ms;

    &:hover {
      background: var(--surface);
    }

    &:has(input:checked) {
      border-color: var(--accent);
      background: var(--accent-container);
    }

    & [type="radio"] {
      margin: 0;
    }
  }

  .dialog-note {
    margin: 0;
    color: var(--fg-subtle);
    font-size: 0.75rem;
  }
</style>

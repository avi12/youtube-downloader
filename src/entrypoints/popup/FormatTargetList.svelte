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
  <p class="dialog-note">No alternative formats available for this file.</p>
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
    Transcoding takes {estimatedTimeLabel}. The download will restart with the new format.
  </p>
{/if}

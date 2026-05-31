<script lang="ts">
  import type { FormatGroup } from "@/lib/utils/containers";

  interface Props {
    groups: FormatGroup[];
    selectedTarget: string;
    estimatedTimeLabel: string;
    onSelect: (target: string) => void;
  }

  const { groups, selectedTarget, estimatedTimeLabel, onSelect }: Props = $props();
</script>

{#if groups.length === 0}
  <p class="dialog-note">No alternative formats available for this file</p>
{:else}
  <fieldset class="target-groups">
    <legend class="visually-hidden">Target format</legend>
    {#each groups as group (group.heading)}
      <div class="target-group" aria-label={group.caption ?? group.heading} role="group">
        <p class="target-group-heading">{group.caption ?? group.heading}</p>
        <div class="target-list">
          {#each group.items as item (item.extension)}
            <label class="target-option" class:is-excluded={item.isExcluded}>
              <input
                name="target-format"
                checked={selectedTarget === item.extension}
                disabled={item.isExcluded}
                onchange={() => onSelect(item.extension)}
                type="radio"
                value={item.extension}
              />
              <span class="target-label">
                <span class="target-ext">
                  {item.extension}
                  {#if item.isSlow}
                    <span class="target-slow-tag" data-tooltip="Requires video re-encoding">slower</span>
                  {/if}
                </span>
                {#if item.description}
                  <span class="target-desc">{item.description}</span>
                {/if}
              </span>
            </label>
          {/each}
        </div>
      </div>
    {/each}
  </fieldset>

  <p class="dialog-note">
    Transcoding takes {estimatedTimeLabel}. The download will restart with the new format
  </p>
{/if}

<style>
  .target-groups {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: none;

    .visually-hidden {
      position: absolute;
      overflow: hidden;
      width: 1px;
      height: 1px;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    .target-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .target-group-heading {
      margin: 0;
      color: var(--fg-muted);
      font-weight: 500;
      font-size: 0.75rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .target-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
    }

    .target-option {
      display: flex;
      gap: 6px;
      align-items: center;
      min-width: 0;
      padding: 6px 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--fg);
      font-size: 0.8125rem;
      cursor: pointer;
      transition: background-color 150ms;

      .target-label {
        display: flex;
        flex-direction: column;
        gap: 1px;
      }

      .target-desc {
        color: var(--fg-subtle);
        font-size: 0.6875rem;
      }

      .target-slow-tag {
        display: inline-block;
        vertical-align: middle;
        margin-inline-start: 4px;
        padding: 1px 6px;
        border-radius: 8px;
        background: var(--accent-container);
        color: var(--fg);
        font-weight: 500;
        font-size: 0.625rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      &:hover {
        background: var(--surface);
      }

      &:has(input:checked) {
        border-color: var(--accent);
        background: var(--accent-container);
      }

      &.is-excluded {
        opacity: 50%;
        cursor: not-allowed;

        &:hover {
          background: transparent;
        }
      }

      [type="radio"] {
        margin: 0;
      }
    }
  }

  .dialog-note {
    margin: 0;
    color: var(--fg-subtle);
    font-size: 0.75rem;
  }
</style>

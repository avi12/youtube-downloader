<script lang="ts">
  import audioIcon from "../icons/audio.svg?raw";
  import closeIcon from "../icons/close.svg?raw";
  import videoIcon from "../icons/video.svg?raw";
  import {
    buildAvailableTargetGroups,
    isAudioSourceEntry,
    submitTranscode
  } from "./change-format-helpers";
  import FormatGrid from "./FormatGrid.svelte";
  import { FORMAT_GROUP_AUDIO, FORMAT_GROUP_VIDEO } from "@/lib/utils/containers";
  import type { FormatGroup, FormatItem } from "@/lib/utils/containers";
  import type { RecentDownloadEntry } from "@/types";

  interface Props {
    entry: RecentDownloadEntry;
    onClose: () => void;
  }

  const { entry, onClose }: Props = $props();

  const isAudioSource = $derived(isAudioSourceEntry(entry));
  const anchorName = $derived(`--cf-${entry.id.replace(/[^a-zA-Z0-9-]/g, "")}`);
  const targetGroups = $derived(buildAvailableTargetGroups({ entry }));
  const videoItems = $derived(
    findGroup(targetGroups, FORMAT_GROUP_VIDEO)?.items ?? []
  );
  const audioItems = $derived(
    findGroup(targetGroups, FORMAT_GROUP_AUDIO)?.items ?? []
  );
  const hasVideoMode = $derived(!isAudioSource && videoItems.length > 0);
  const hasAudioMode = $derived(audioItems.length > 0);

  let mode = $state<"video" | "audio">("video");

  $effect(() => {
    if (!hasVideoMode && hasAudioMode) {
      mode = "audio";
    }
  });

  const activeItems = $derived(mode === "video" ? videoItems : audioItems);

  let isSubmitting = $state(false);
  let pendingExtension = $state<string | null>(null);
  let isClosing = $state(false);

  function handleLayerPointerDown(): void {
    startClose();
  }

  function stopPropagation(e: Event): void {
    e.stopPropagation();
  }

  function findGroup(groups: FormatGroup[], heading: string) {
    return groups.find(group => group.heading === heading);
  }

  function startClose(): void {
    isClosing = true;
  }

  async function handleSelect(item: FormatItem): Promise<void> {
    if (item.isCurrent || item.isExcluded || isSubmitting) {
      return;
    }

    pendingExtension = item.extension;
    isSubmitting = true;
    try {
      const isSuccess = await submitTranscode({
        entry,
        selectedTarget: item.extension,
        isSubmitting: false
      });
      if (isSuccess) {
        startClose();
        return;
      }

      isSubmitting = false;
      pendingExtension = null;
    } catch (error) {
      console.warn("[ytdl:popup] Transcode request failed:", error);
      isSubmitting = false;
      pendingExtension = null;
    }
  }

  function handleWindowKeydown(e: KeyboardEvent): void {
    const isEscape = e.key === "Escape";
    if (isEscape) {
      startClose();
    }
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div
  class="popover-layer"
  class:popover-layer--closing={isClosing}
  onpointerdown={handleLayerPointerDown}
  role="presentation"
></div>

<div
  style:position-anchor={anchorName}
  class="dialog"
  class:closing={isClosing}
  aria-labelledby="change-format-title"
  aria-modal="false"
  onanimationend={() => {
    if (isClosing) {
      onClose();
    }
  }}
  onpointerdown={stopPropagation}
  role="dialog"
>
  <header class="dialog-header">
    <h2 id="change-format-title" class="dialog-title">Change format</h2>
    <button
      class="dialog-close"
      aria-label="Close"
      onclick={startClose}
      type="button"
    >
      {@html closeIcon}
    </button>
  </header>

  <div class="dialog-body">
    {#if hasVideoMode && hasAudioMode}
      <div class="mode-toggle" role="tablist">
        <button
          class="mode-btn"
          class:mode-btn--active={mode === "video"}
          aria-selected={mode === "video"}
          onclick={() => (mode = "video")}
          role="tab"
          type="button"
        >
          <span class="mode-icon" aria-hidden="true">{@html videoIcon}</span>
          Video
        </button>
        <button
          class="mode-btn"
          class:mode-btn--active={mode === "audio"}
          aria-selected={mode === "audio"}
          onclick={() => (mode = "audio")}
          role="tab"
          type="button"
        >
          <span class="mode-icon" aria-hidden="true">{@html audioIcon}</span>
          Extract audio
        </button>
      </div>
    {/if}

    {#if activeItems.length === 0}
      <p class="dialog-empty">No alternative formats available</p>
    {:else}
      <p class="dialog-description">
        <strong>Instant</strong> just repackages the file. Others re-encode the {mode === "video" ? "video" : "audio"} — <strong>Slower</strong> targets use a legacy codec and take noticeably longer
      </p>
      <FormatGrid
        items={activeItems}
        onSelect={handleSelect}
        pendingExtension={isSubmitting ? pendingExtension : null}
      />
    {/if}
  </div>
</div>

<style>
  .popover-layer {
    position: fixed;
    inset: 0;
    z-index: 49;
    animation: layer-in 180ms ease-out;
  }

  .popover-layer--closing {
    animation: layer-out 160ms ease-in forwards;
  }

  .dialog {
    position: fixed;
    inset-block-start: calc(anchor(bottom) + 8px);
    inset-inline-end: anchor(right);
    inset-inline-start: auto;
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow: hidden;
    box-sizing: border-box;
    width: 340px;
    max-width: calc(100vw - 24px);
    max-height: calc(100vh - 24px);
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: 20px;
    background: var(--surface-high);
    color: var(--fg);
    box-shadow:
      0 12px 32px rgb(0 0 0 / 24%),
      0 4px 12px rgb(0 0 0 / 16%);
    animation: dialog-in 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
    position-try-fallbacks: --above;

    &.closing {
      animation: dialog-out 180ms cubic-bezier(0.36, 0, 0.66, -0.56) forwards;
    }
  }

  @position-try --above {
    inset-block-end: calc(anchor(top) + 8px);
    inset-block-start: auto;
    inset-inline-end: anchor(right);
    inset-inline-start: auto;
  }

  .dialog-header {
    display: flex;
    flex-shrink: 0;
    gap: 8px;
    justify-content: space-between;
    align-items: center;
  }

  .dialog-body {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 10px;
    overflow-y: auto;
    min-height: 0;
    scrollbar-color: var(--border) transparent;
    scrollbar-width: thin;

    &::-webkit-scrollbar {
      width: 6px;
    }

    &::-webkit-scrollbar-track {
      background: transparent;
    }

    &::-webkit-scrollbar-thumb {
      border-radius: 3px;
      background: var(--border);
    }

    &::-webkit-scrollbar-thumb:hover {
      background: var(--fg-subtle);
    }
  }

  .dialog-title {
    margin: 0;
    color: var(--fg-muted);
    font-weight: 600;
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .dialog-close {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--fg-muted);
    cursor: pointer;
    transition: background-color 200ms, color 200ms;

    &:hover {
      background: var(--accent-hover);
      color: var(--fg);
    }

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    :global(svg) {
      width: 16px;
      height: 16px;
    }
  }

  .mode-toggle {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    padding: 4px;
    border-radius: 999px;
    background: var(--surface);

    .mode-btn {
      display: inline-flex;
      gap: 6px;
      justify-content: center;
      align-items: center;
      padding: 8px 12px;
      border: none;
      border-radius: 999px;
      background: transparent;
      color: var(--fg-muted);
      font-family: inherit;
      font-weight: 600;
      font-size: 0.8125rem;
      cursor: pointer;
      transition: background-color 200ms, color 200ms;

      &:hover:not(.mode-btn--active) {
        color: var(--fg);
      }

      &:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }

      .mode-icon {
        display: inline-flex;

        :global(svg) {
          width: 16px;
          height: 16px;
        }
      }
    }

    .mode-btn--active {
      background: var(--accent);
      color: var(--on-primary);
    }
  }

  .dialog-empty {
    margin: 0;
    color: var(--fg-subtle);
    font-size: 0.8125rem;
  }

  .dialog-description {
    margin: 0;
    color: var(--fg-muted);
    font-size: 0.75rem;
    line-height: 1.45;

    & strong {
      color: var(--fg);
      font-weight: 700;
    }
  }

  @keyframes layer-in {
    from {
      opacity: 0%;
    }

    to {
      opacity: 100%;
    }
  }

  @keyframes layer-out {
    from {
      opacity: 100%;
    }

    to {
      opacity: 0%;
    }
  }

  @keyframes dialog-in {
    from {
      opacity: 0%;
      scale: 0.92;
      translate: 0 8px;
    }

    to {
      opacity: 100%;
      scale: 1;
      translate: 0 0;
    }
  }

  @keyframes dialog-out {
    from {
      opacity: 100%;
      scale: 1;
      translate: 0 0;
    }

    to {
      opacity: 0%;
      scale: 0.92;
      translate: 0 8px;
    }
  }
</style>

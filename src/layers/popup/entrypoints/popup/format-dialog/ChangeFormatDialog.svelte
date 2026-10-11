<script lang="ts">
  import audioIcon from "../icons/audio.svg?raw";
  import closeIcon from "../icons/close.svg?raw";
  import videoIcon from "../icons/video.svg?raw";
  import { buildAvailableTargetGroups, isAudioSourceEntry, submitTranscode } from "./change-format-helpers";
  import FormatGrid from "./FormatGrid.svelte";
  import type { FormatGroup, FormatItem } from "@/lib/utils/containers";
  import { FORMAT_GROUP_AUDIO, FORMAT_GROUP_VIDEO } from "@/lib/utils/containers";
  import { createLogger, LogScope } from "@/lib/utils/logger";
  import { resolveDisplayThumbnailUrl } from "@/lib/youtube/thumbnail-url";
  import type { RecentDownloadEntry } from "@/types";
  import { flushSync } from "svelte";

  const log = createLogger(LogScope.Popup);

  interface Props {
    entry: RecentDownloadEntry;
    onClose: () => void;
  }

  const DialogMode = {
    Video: "video",
    Audio: "audio"
  } as const;
  type DialogMode = (typeof DialogMode)[keyof typeof DialogMode];

  const ANCHOR_NAME_PREFIX = "--cf-";
  const ANCHOR_NAME_SANITIZE_PATTERN = /[^a-zA-Z0-9-]/g;
  const { entry, onClose }: Props = $props();

  const isAudioSource = $derived(isAudioSourceEntry(entry));
  const displayThumbnailUrl = $derived(resolveDisplayThumbnailUrl(entry));
  const anchorName = $derived(
    `${ANCHOR_NAME_PREFIX}${entry.id.replace(ANCHOR_NAME_SANITIZE_PATTERN, "")}`
  );
  const targetGroups = $derived(buildAvailableTargetGroups({ entry }));
  const videoItems = $derived(
    findGroup(targetGroups, FORMAT_GROUP_VIDEO)?.items ?? []
  );
  const audioItems = $derived(
    findGroup(targetGroups, FORMAT_GROUP_AUDIO)?.items ?? []
  );
  const hasVideoMode = $derived(!isAudioSource && videoItems.length > 0);
  const hasAudioMode = $derived(audioItems.length > 0);

  let mode = $state<DialogMode>(DialogMode.Video);
  let hasSwitchedMode = $state(false);

  function switchMode(nextMode: DialogMode): void {
    hasSwitchedMode = true;

    if (!document.startViewTransition) {
      mode = nextMode;
      return;
    }

    document.startViewTransition(() => flushSync(() => {
      mode = nextMode;
    }));
  }

  $effect(() => {
    if (!hasVideoMode && hasAudioMode) {
      mode = DialogMode.Audio;
    }
  });

  const activeItems = $derived(mode === DialogMode.Video ? videoItems : audioItems);

  let isSubmitting = $state(false);
  let pendingExtension = $state<string | null>(null);
  let isClosing = $state(false);
  let elDialog = $state<HTMLDialogElement | null>(null);

  $effect(() => {
    elDialog?.show();
  });

  function findGroup(groups: FormatGroup[], heading: string): FormatGroup | undefined {
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
      log.warn("Transcode request failed:", error);
      isSubmitting = false;
      pendingExtension = null;
    }
  }
</script>

<svelte:window
  onkeydown={e => {
    if (e.key === "Escape") {
      startClose();
    }
  }} />

<div
  class="popover-layer"
  class:popover-layer--closing={isClosing}
  onpointerdown={() => startClose()}
  role="presentation"
></div>

<dialog
  bind:this={elDialog}
  style:position-anchor={anchorName}
  class="dialog"
  class:closing={isClosing}
  aria-labelledby="change-format-title"
  onanimationend={() => {
    if (isClosing) {
      onClose();
    }
  }}
  onpointerdown={e => e.stopPropagation()}
>
  <header style:view-transition-group="nearest" class="dialog-header">
    <div class="dialog-header-row">
      {#if displayThumbnailUrl}
        <img class="dialog-thumbnail" alt="" src={displayThumbnailUrl} />
      {/if}
      <div class="dialog-heading">
        <h2 id="change-format-title" class="dialog-title">Change format</h2>
        <span class="dialog-video-title" dir="auto">{entry.title}</span>
      </div>
      <button
        class="dialog-close"
        aria-label="Close"
        onclick={startClose}
        type="button"
      >
        {@html closeIcon}
      </button>
    </div>
    {#if hasVideoMode && hasAudioMode}
      <div class="mode-toggle" role="tablist">
        <button
          class="mode-btn"
          class:mode-btn--active={mode === DialogMode.Video}
          aria-selected={mode === DialogMode.Video}
          onclick={() => switchMode(DialogMode.Video)}
          role="tab"
          type="button"
        >
          <span class="mode-icon" aria-hidden="true">{@html videoIcon}</span>
          Video
        </button>
        <button
          class="mode-btn"
          class:mode-btn--active={mode === DialogMode.Audio}
          aria-selected={mode === DialogMode.Audio}
          onclick={() => switchMode(DialogMode.Audio)}
          role="tab"
          type="button"
        >
          <span class="mode-icon" aria-hidden="true">{@html audioIcon}</span>
          Extract audio
        </button>
      </div>
    {/if}

    {#if activeItems.length > 0}
      <p class="dialog-description">
        {#if mode === DialogMode.Video}
          <strong>Instant</strong> just repackages the file.
          Others re-encode the video — <strong>Slower</strong>
          targets use a legacy codec and take noticeably longer
        {:else}
          <strong>Instant</strong> just repackages the file. Others re-encode the audio
        {/if}
      </p>
    {/if}
  </header>

  <div style:view-transition-group="nearest" class="dialog-body">
    {#key mode}
      <div class="mode-panel mode-panel--{mode}" class:mode-panel--switched={hasSwitchedMode}>
        {#if activeItems.length === 0}
          <p class="dialog-empty">No alternative formats available</p>
        {:else}
          <FormatGrid
            items={activeItems}
            onSelect={handleSelect}
            pendingExtension={isSubmitting ? pendingExtension : null}
          />
        {/if}
      </div>
    {/key}
  </div>
</dialog>

<style>
  .popover-layer {
    position: fixed;
    inset: 0;
    z-index: 49;
    animation: layer-in 180ms ease-out;

    &.popover-layer--closing {
      animation: layer-out 160ms ease-in forwards;
    }
  }

  .dialog {
    position: fixed;
    inset-block: calc(anchor(bottom) + 8px) 12px;
    inset-inline: 12px;
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-self: start;
    overflow: hidden;
    box-sizing: border-box;
    width: auto;
    height: auto;
    min-height: min(420px, calc(100vh - 24px));
    margin: 0;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: 20px;
    background: var(--surface-high);
    color: var(--fg);
    box-shadow:
      0 12px 32px rgb(0 0 0 / 24%),
      0 4px 12px rgb(0 0 0 / 16%);
    view-transition-name: change-format-dialog;
    animation: dialog-in 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
    position-try-fallbacks: --change-format-above, --change-format-viewport;

    &.closing {
      animation: dialog-out 180ms cubic-bezier(0.36, 0, 0.66, -0.56) forwards;
    }
  }

  @position-try --change-format-above {
    inset-block: 12px calc(anchor(top) + 8px);
    align-self: end;
  }

  @position-try --change-format-viewport {
    inset-block: 12px;
  }

  .dialog-header {
    display: flex;
    flex-shrink: 0;
    flex-direction: column;
    gap: 10px;
    view-transition-name: change-format-header;

    .dialog-header-row {
      display: flex;
      gap: 8px;
      justify-content: space-between;
      align-items: center;
    }
  }

  .dialog-body {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 10px;
    overflow: hidden auto;
    min-height: 0;
    margin-inline: -4px;
    padding-inline: 4px;
    scrollbar-color: var(--border) transparent;
    scrollbar-width: thin;
    view-transition-name: change-format-body;

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

  .dialog-thumbnail {
    flex-shrink: 0;
    object-fit: cover;
    width: 64px;
    border-radius: 8px;
    aspect-ratio: 16 / 9;
  }

  .dialog-heading {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .dialog-video-title {
    overflow: hidden;
    font-weight: 600;
    font-size: 0.875rem;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    padding: 4px;
    border-radius: 999px;
    background: var(--surface);

    &::before {
      content: "";
      position: absolute;
      inset-block: 4px;
      inset-inline-start: 4px;
      width: calc(50% - 6px);
      border-radius: 999px;
      background: var(--accent);
      transition: translate 280ms cubic-bezier(0.2, 0, 0, 1);
    }

    &:has(.mode-btn--active:last-child)::before {
      translate: calc(100% + 4px);
    }

    .mode-btn {
      position: relative;
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
      transition: color 200ms;

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
      color: var(--on-primary);
    }
  }

  .mode-panel {
    --mode-panel-offset: -24px;

    &.mode-panel--switched {
      animation: mode-panel-in 280ms cubic-bezier(0.2, 0, 0, 1);
    }

    &.mode-panel--audio {
      --mode-panel-offset: 24px;
    }
  }

  @keyframes mode-panel-in {
    from {
      opacity: 0%;
      translate: var(--mode-panel-offset) 0;
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

  :global {
    ::view-transition-group(change-format-dialog),
    ::view-transition-group(change-format-header),
    ::view-transition-group(change-format-body) {
      animation-duration: 280ms;
      animation-timing-function: cubic-bezier(0.2, 0, 0, 1);
    }

    ::view-transition-old(change-format-dialog),
    ::view-transition-new(change-format-dialog) {
      height: 100%;
      animation: none;
    }

    ::view-transition-old(change-format-header),
    ::view-transition-old(change-format-body) {
      display: none;
    }

    ::view-transition-new(change-format-header),
    ::view-transition-new(change-format-body) {
      animation: none;
    }

    /* stylelint-disable-next-line selector-pseudo-element-no-unknown */
    ::view-transition-group-children(change-format-dialog) {
      overflow: clip;
      border-radius: 20px;
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

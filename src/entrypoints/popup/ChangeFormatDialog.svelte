<script lang="ts">
  import { MessageType, sendMessage } from "@/lib/messaging/messaging";
  import {
    audioContainers,
    isCompatibleForRemux,
    splitFilenameAndExtension,
    videoContainers
  } from "@/lib/utils/containers";
  import type { RecentDownloadEntry } from "@/types";

  interface Props {
    entry: RecentDownloadEntry;
    onClose: () => void;
  }

  const { entry, onClose }: Props = $props();

  const isVideoContainer = $derived(videoContainers.includes(entry.container));
  const availableTargets = $derived(
    (isVideoContainer ? videoContainers : audioContainers)
      .filter(target => target !== entry.container)
      .filter(target => !isVideoContainer || !entry.videoMimeType || isCompatibleForRemux(entry.videoMimeType, entry.audioMimeType ?? "", target))
  );

  let selectedTarget = $state("");

  $effect(() => {
    if (!selectedTarget && availableTargets.length > 0) {
      [selectedTarget] = availableTargets;
    }
  });
  let isSubmitting = $state(false);
  let isClosing = $state(false);

  const estimatedSecondsLabel = $derived(describeEstimatedTime(entry.size));

  function describeEstimatedTime(sizeBytes: number) {
    const approxSecondsPerMegabyte = 0.05;
    const seconds = Math.max(1, Math.round((sizeBytes / (1024 * 1024)) * approxSecondsPerMegabyte));
    if (seconds < 60) {
      return `~${seconds}s`;
    }

    const minutes = Math.round(seconds / 60);
    return `~${minutes} min`;
  }

  function startClose() {
    isClosing = true;
  }

  async function handleConfirm() {
    if (!selectedTarget || isSubmitting) {
      return;
    }

    isSubmitting = true;
    try {
      const filenameOutput = `${splitFilenameAndExtension(entry.filename).name}.${selectedTarget}`;
      await sendMessage(MessageType.TranscodeRecentDownload, {
        entryId: entry.id,
        targetContainer: selectedTarget,
        filenameOutput
      });
      startClose();
    } catch (error) {
      console.warn("[ytdl:popup] Transcode request failed:", error);
      isSubmitting = false;
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      startClose();
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
  class="dialog-backdrop"
  class:closing={isClosing}
  onclick={handleBackdropClick}
  role="presentation"
>
  <div
    class="dialog"
    aria-labelledby="change-format-title"
    aria-modal="true"
    onanimationend={() => {
      if (isClosing) {
        onClose();
      }
    }}
    role="dialog"
  >
    <h2 id="change-format-title" class="dialog-title">Change format</h2>
    <p class="dialog-body">
      Convert <strong>{entry.title}</strong> from <code>{entry.container}</code> to:
    </p>

    {#if availableTargets.length === 0}
      <p class="dialog-note">No alternative formats available for this file.</p>
    {:else}
      <div class="target-list" aria-label="Target format" role="radiogroup">
        {#each availableTargets as target (target)}
          <label class="target-option">
            <input
              name="target-format"
              type="radio"
              value={target}
              bind:group={selectedTarget}
            />
            <span>{target}</span>
          </label>
        {/each}
      </div>

      <p class="dialog-note">
        Transcoding takes {estimatedSecondsLabel}. The download will restart with the new format.
      </p>
    {/if}

    <div class="dialog-actions">
      <button
        class="dialog-button dialog-button-secondary"
        onclick={startClose}
        type="button"
      >
        Cancel
      </button>
      <button
        class="dialog-button dialog-button-primary"
        disabled={!selectedTarget || isSubmitting || availableTargets.length === 0}
        onclick={handleConfirm}
        type="button"
      >
        {isSubmitting ? "Queuing…" : "Transcode"}
      </button>
    </div>
  </div>
</div>

<style>
  .dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 16px;
    background: rgb(0 0 0 / 40%);
    animation: backdrop-in 200ms ease-out;
  }

  .dialog {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    max-width: 360px;
    padding: 20px;
    border-radius: 16px;
    background: var(--surface-high);
    color: var(--fg);
    animation: dialog-in 240ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .dialog-title {
    margin: 0;
    font-weight: 500;
    font-size: 1.125rem;
  }

  .dialog-body {
    margin: 0;
    color: var(--fg-muted);
    font-size: 0.8125rem;
    line-height: 1.4;

    & strong {
      color: var(--fg);
    }

    & code {
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--surface);
      font-family: inherit;
      font-size: 0.75rem;
    }
  }

  .dialog-note {
    margin: 0;
    color: var(--fg-subtle);
    font-size: 0.75rem;
  }

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

  .dialog-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 4px;
  }

  .dialog-button {
    padding: 8px 16px;
    border: none;
    border-radius: 20px;
    font-family: inherit;
    font-weight: 500;
    font-size: 0.8125rem;
    cursor: pointer;
    transition: background-color 150ms, transform 120ms;

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    &:active {
      transform: scale(0.97);
    }

    &[disabled] {
      opacity: 50%;
      cursor: not-allowed;
    }
  }

  .dialog-button-secondary {
    background: transparent;
    color: var(--fg-muted);

    &:hover:not([disabled]) {
      background: var(--surface);
    }
  }

  .dialog-button-primary {
    background: var(--accent);
    color: var(--md-sys-color-on-primary);

    &:hover:not([disabled]) {
      background: var(--accent-container);
      color: var(--fg);
    }
  }

  .dialog-backdrop.closing {
    animation: backdrop-out 200ms ease-in forwards;
  }

  .dialog-backdrop.closing .dialog {
    animation: dialog-out 240ms cubic-bezier(0.36, 0, 0.66, -0.56) forwards;
  }

  @keyframes backdrop-in {
    from {
      opacity: 0%;
    }

    to {
      opacity: 100%;
    }
  }

  @keyframes backdrop-out {
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
      transform: scale(0.92) translateY(8px);
    }

    to {
      opacity: 100%;
      transform: scale(1) translateY(0);
    }
  }

  @keyframes dialog-out {
    from {
      opacity: 100%;
      transform: scale(1) translateY(0);
    }

    to {
      opacity: 0%;
      transform: scale(0.92) translateY(8px);
    }
  }
</style>

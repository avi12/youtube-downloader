<script lang="ts">
  import { buildAvailableTargets, buildEstimatedTimeLabel, submitTranscode } from "./change-format-helpers";
  import ChangeFormatActions from "./ChangeFormatActions.svelte";
  import FormatTargetList from "./FormatTargetList.svelte";
  import { videoContainers } from "@/lib/utils/containers";
  import type { RecentDownloadEntry } from "@/types";

  interface Props {
    entry: RecentDownloadEntry;
    onClose: () => void;
  }

  const { entry, onClose }: Props = $props();

  const isVideoContainer = $derived(videoContainers.includes(entry.container));
  const availableTargets = $derived(buildAvailableTargets(entry, isVideoContainer));

  let selectedTarget = $state("");
  let isSubmitting = $state(false);
  let isClosing = $state(false);

  $effect(() => {
    if (!selectedTarget && availableTargets.length > 0) {
      [selectedTarget] = availableTargets;
    }
  });

  const estimatedTimeLabel = $derived(buildEstimatedTimeLabel(entry.size));

  function startClose() {
    isClosing = true;
  }

  async function handleConfirm() {
    isSubmitting = true;
    try {
      const done = await submitTranscode({
        entry,
        selectedTarget,
        isSubmitting: false
      });
      if (done) {
        startClose();
      }
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
    <FormatTargetList
      {estimatedTimeLabel}
      onSelect={target => (selectedTarget = target)}
      {selectedTarget}
      targets={availableTargets}
    />
    <ChangeFormatActions
      isDisabled={!selectedTarget || isSubmitting || availableTargets.length === 0}
      {isSubmitting}
      onCancel={startClose}
      onConfirm={handleConfirm}
    />
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

<script lang="ts">
  import {
    buildAvailableTargetGroups,
    buildEstimatedTimeLabel,
    pickFirstSelectableTarget,
    submitTranscode
  } from "./change-format-helpers";
  import ChangeFormatActions from "./ChangeFormatActions.svelte";
  import FormatTargetList from "./FormatTargetList.svelte";
  import type { RecentDownloadEntry } from "@/types";

  interface Props {
    entry: RecentDownloadEntry;
    onClose: () => void;
  }

  const { entry, onClose }: Props = $props();

  const targetGroups = $derived(buildAvailableTargetGroups({ entry }));
  const hasAnyTarget = $derived(targetGroups.some(group => group.items.some(item => !item.isExcluded)));

  let selectedTarget = $state("");
  let isSubmitting = $state(false);
  let isClosing = $state(false);
  let elDialog = $state<HTMLDialogElement | null>(null);

  $effect(() => {
    elDialog?.showModal();
  });

  $effect(() => {
    if (!selectedTarget && hasAnyTarget) {
      selectedTarget = pickFirstSelectableTarget(targetGroups);
    }
  });

  const estimatedTimeLabel = $derived(buildEstimatedTimeLabel(entry.size));

  function startClose(): void {
    isClosing = true;
  }

  async function handleConfirm(): Promise<void> {
    isSubmitting = true;
    try {
      const isSuccess = await submitTranscode({
        entry,
        selectedTarget,
        isSubmitting: false
      });
      if (isSuccess) {
        startClose();
      }
    } catch (error) {
      console.warn("[ytdl:popup] Transcode request failed:", error);
      isSubmitting = false;
    }
  }

  function handleBackdropClick(e: MouseEvent): void {
    const isBackdropClick = e.target === e.currentTarget;
    if (isBackdropClick) {
      startClose();
    }
  }

  function handleWindowKeydown(e: KeyboardEvent): void {
    const isEscape = e.key === "Escape";
    if (isEscape) {
      startClose();
    }
  }

  const isConfirmDisabled = $derived(!selectedTarget || isSubmitting || !hasAnyTarget);
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<dialog
  bind:this={elDialog}
  class="dialog"
  class:closing={isClosing}
  aria-labelledby="change-format-title"
  onanimationend={() => {
    if (isClosing) {
      onClose();
    }
  }}
  onclick={handleBackdropClick}
>
  <h2 id="change-format-title" class="dialog-title">Change format</h2>
  <p class="dialog-body">
    Convert <strong>{entry.title}</strong> from <code>{entry.container}</code> to:
  </p>
  <FormatTargetList
    {estimatedTimeLabel}
    groups={targetGroups}
    onSelect={target => (selectedTarget = target)}
    {selectedTarget}
  />
  <ChangeFormatActions
    isDisabled={isConfirmDisabled}
    {isSubmitting}
    onCancel={startClose}
    onConfirm={handleConfirm}
  />
</dialog>

<style>
  .dialog {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    max-width: 360px;
    padding: 20px;
    border: none;
    border-radius: 16px;
    background: var(--surface-high);
    color: var(--fg);
    box-shadow: 0 8px 32px rgb(0 0 0 / 12%);
    animation: dialog-in 240ms cubic-bezier(0.34, 1.56, 0.64, 1);

    &::backdrop {
      background: rgb(0 0 0 / 40%);
      animation: backdrop-in 200ms ease-out;
    }

    &.closing {
      animation: dialog-out 240ms cubic-bezier(0.36, 0, 0.66, -0.56) forwards;

      &::backdrop {
        animation: backdrop-out 200ms ease-in forwards;
      }
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

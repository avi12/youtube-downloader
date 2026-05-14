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

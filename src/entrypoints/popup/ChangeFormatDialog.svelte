<script lang="ts">
  import FormatTargetList from "./FormatTargetList.svelte";
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

  const APPROX_SECONDS_PER_MB = 0.05;

  const isVideoContainer = $derived(videoContainers.includes(entry.container));
  const availableTargets = $derived(
    (isVideoContainer ? videoContainers : audioContainers)
      .filter(target => target !== entry.container)
      .filter(target => !isVideoContainer || !entry.videoMimeType || isCompatibleForRemux(entry.videoMimeType, entry.audioMimeType ?? "", target))
  );

  let selectedTarget = $state("");
  let isSubmitting = $state(false);
  let isClosing = $state(false);

  $effect(() => {
    if (!selectedTarget && availableTargets.length > 0) {
      [selectedTarget] = availableTargets;
    }
  });

  const estimatedTimeLabel = $derived.by(() => {
    const seconds = Math.max(1, Math.round((entry.size / (1024 * 1024)) * APPROX_SECONDS_PER_MB));
    return seconds < 60 ? `~${seconds}s` : `~${Math.round(seconds / 60)} min`;
  });

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

    <FormatTargetList
      {estimatedTimeLabel}
      onSelect={target => (selectedTarget = target)}
      {selectedTarget}
      targets={availableTargets}
    />

    <div class="dialog-actions">
      <button class="dialog-button dialog-button-secondary" onclick={startClose} type="button">
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

<script lang="ts">
  interface Props {
    isSubmitting: boolean;
    isDisabled: boolean;
    onCancel: () => void;
    onConfirm: () => void;
  }

  const { isSubmitting, isDisabled, onCancel, onConfirm }: Props = $props();
</script>

<div class="dialog-actions">
  <button class="dialog-button dialog-button-secondary" onclick={onCancel} type="button">
    Cancel
  </button>
  <button
    class="dialog-button dialog-button-primary"
    disabled={isDisabled}
    onclick={onConfirm}
    type="button"
  >
    {isSubmitting ? "Queuing…" : "Transcode"}
  </button>
</div>

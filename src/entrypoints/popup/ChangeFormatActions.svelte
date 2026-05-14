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

<style>
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
</style>

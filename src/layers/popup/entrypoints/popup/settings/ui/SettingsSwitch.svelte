<script lang="ts">
  interface Props {
    isChecked: boolean;
    isDisabled?: boolean;
    onchange: (isChecked: boolean) => void;
  }

  const { isChecked, isDisabled = false, onchange }: Props = $props();
</script>

<span class="set-switch">
  <input
    class="set-switch-input"
    checked={isChecked}
    disabled={isDisabled}
    onchange={e => onchange(e.currentTarget.checked)}
    role="switch"
    type="checkbox"
  />
  <span class="set-switch-track"></span>
</span>

<style>
  .set-switch {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
  }

  .set-switch-track {
    position: relative;
    display: block;
    width: 52px;
    height: 32px;
    border-radius: 16px;
    background-color: var(--surface-high);
    box-shadow: inset 0 0 0 2px var(--fg-subtle);
    cursor: pointer;
    transition: background-color 250ms, box-shadow 250ms;

    &::after {
      content: "";
      position: absolute;
      top: 50%;
      left: 16px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background-color: var(--fg-subtle);
      transition:
        translate 300ms cubic-bezier(0.34, 1.56, 0.64, 1),
        scale 300ms cubic-bezier(0.34, 1.56, 0.64, 1),
        background-color 200ms;
      translate: -50% -50%;
    }
  }

  .set-switch-input {
    position: absolute;
    width: 0;
    height: 0;
    opacity: 0%;

    &:checked + .set-switch-track {
      background-color: var(--accent);
      box-shadow: inset 0 0 0 2px var(--accent);
    }

    &:checked + .set-switch-track::after {
      background-color: var(--on-primary);
      scale: 1.5;
      translate: calc(-50% + 22px) -50%;
    }

    &:focus-visible + .set-switch-track {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    &:disabled + .set-switch-track {
      opacity: 38%;
      cursor: not-allowed;
    }
  }
</style>

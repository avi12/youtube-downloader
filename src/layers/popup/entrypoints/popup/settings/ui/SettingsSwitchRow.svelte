<script lang="ts">
  import SettingsSwitch from "./SettingsSwitch.svelte";

  interface Props {
    icon: string;
    isAccent?: boolean;
    label: string;
    isChecked: boolean;
    onchange: (isChecked: boolean) => void;
  }

  const { icon, isAccent, label, isChecked, onchange }: Props = $props();
</script>

<label class="set-item">
  <div class="set-lead" class:accent={isAccent}>
    {@html icon}
  </div>
  <div class="set-txt">
    <span class="set-label">{label}</span>
  </div>
  <div class="set-trail">
    <SettingsSwitch {isChecked} {onchange} />
  </div>
</label>

<style>
  .set-item {
    display: flex;
    gap: 13px;
    align-items: center;
    min-height: 52px;
    padding: 13px 14px;
    cursor: pointer;
  }

  .set-lead {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: var(--surface-high);
    color: var(--fg-muted);

    &.accent {
      background: var(--accent-container);
      color: var(--fg);
    }

    :global(svg) {
      width: 20px;
      height: 20px;
    }
  }

  .set-txt {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .set-label {
    color: var(--fg);
    font-weight: 500;
    font-size: 0.84375rem;
  }

  .set-trail {
    display: flex;
    flex-shrink: 0;
    gap: 8px;
    align-items: center;
    color: var(--fg-muted);
  }
</style>

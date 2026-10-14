<script lang="ts">
  import SettingsRowContent from "./SettingsRowContent.svelte";
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
  <SettingsRowContent {isAccent} {label}>
    {#snippet lead()}
      {@html icon}
    {/snippet}
    {#snippet trail()}
      <SettingsSwitch {isChecked} {onchange} />
    {/snippet}
  </SettingsRowContent>
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
</style>

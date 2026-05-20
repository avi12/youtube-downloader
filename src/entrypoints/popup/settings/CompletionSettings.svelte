<script lang="ts">
  import type { SettingsProps } from "./settings-types";
  import SettingsGroup from "./SettingsGroup.svelte";
  import { setOption } from "@/lib/storage/storage";

  const { options }: SettingsProps = $props();

  function handleNotifyOnIdleChange(e: Event): void {
    if (e.target instanceof HTMLInputElement) {
      void setOption({
        key: "isNotifyOnIdle",
        value: e.target.checked
      });
    }
  }

  function handleRevealOnCompleteChange(e: Event): void {
    if (e.target instanceof HTMLInputElement) {
      void setOption({
        key: "isRevealOnComplete",
        value: e.target.checked
      });
    }
  }

  function handleShowNativeDownloadChange(e: Event): void {
    if (e.target instanceof HTMLInputElement) {
      void setOption({
        key: "isShowNativeDownload",
        value: e.target.checked
      });
    }
  }
</script>

<SettingsGroup title="When download completes">
  <label class="settings-row">
    <span class="settings-label">Notify when window is idle</span>
    <span class="settings-switch" aria-label="Notify when window is idle">
      <input
        checked={options.isNotifyOnIdle}
        onchange={handleNotifyOnIdleChange}
        role="switch"
        type="checkbox"
      />
      <span class="settings-switch-track">
        <span class="settings-switch-thumb"></span>
      </span>
    </span>
  </label>
  <label class="settings-row">
    <span class="settings-label">Reveal file in folder</span>
    <span class="settings-switch" aria-label="Reveal file in folder">
      <input
        checked={options.isRevealOnComplete}
        onchange={handleRevealOnCompleteChange}
        role="switch"
        type="checkbox"
      />
      <span class="settings-switch-track">
        <span class="settings-switch-thumb"></span>
      </span>
    </span>
  </label>
</SettingsGroup>

<SettingsGroup title="YouTube integration">
  <label class="settings-row">
    <span class="settings-label">Show native download button on watch page</span>
    <span class="settings-switch" aria-label="Show native download button on watch page">
      <input
        checked={options.isShowNativeDownload}
        onchange={handleShowNativeDownloadChange}
        role="switch"
        type="checkbox"
      />
      <span class="settings-switch-track">
        <span class="settings-switch-thumb"></span>
      </span>
    </span>
  </label>
</SettingsGroup>

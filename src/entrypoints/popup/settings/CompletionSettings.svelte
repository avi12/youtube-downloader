<script lang="ts">
  import { setOption } from "@/lib/storage/storage";
  import type { Options } from "@/types";

  interface Props {
    options: Options;
  }

  const { options }: Props = $props();
</script>

<fieldset class="settings-group">
  <legend class="settings-legend">When download completes</legend>
  <label class="settings-row">
    <span class="settings-label">Notify when window is idle</span>
    <span class="settings-switch" aria-label="Notify when window is idle">
      <input
        checked={options.isNotifyOnIdle}
        onchange={e => {
          if (e.target instanceof HTMLInputElement) {
            void setOption("isNotifyOnIdle", e.target.checked);
          }
        }}
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
        onchange={e => {
          if (e.target instanceof HTMLInputElement) {
            void setOption("isRevealOnComplete", e.target.checked);
          }
        }}
        role="switch"
        type="checkbox"
      />
      <span class="settings-switch-track">
        <span class="settings-switch-thumb"></span>
      </span>
    </span>
  </label>
</fieldset>

<fieldset class="settings-group">
  <legend class="settings-legend">YouTube integration</legend>
  <label class="settings-row">
    <span class="settings-label">Show native download button on watch page</span>
    <span class="settings-switch" aria-label="Show native download button on watch page">
      <input
        checked={options.isShowNativeDownload}
        onchange={e => {
          if (e.target instanceof HTMLInputElement) {
            void setOption("isShowNativeDownload", e.target.checked);
          }
        }}
        role="switch"
        type="checkbox"
      />
      <span class="settings-switch-track">
        <span class="settings-switch-thumb"></span>
      </span>
    </span>
  </label>
</fieldset>

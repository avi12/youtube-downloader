<script lang="ts">
  import type { SettingsProps } from "./settings-types";
  import SettingsGroup from "./SettingsGroup.svelte";
  import { setOption } from "@/lib/storage/storage";

  const { options }: SettingsProps = $props();

  const BELL_ICON_PATH = "M160-200v-80h80v-280q0-83 50-147.5T420-792v-28q0-25 17.5-42.5T480-880q25 0 42.5 17.5"
    + "T540-820v28q80 20 130 84.5T720-560v280h80v80H160Zm320-300Zm0 420q-33 0-56.5-23.5T400-160h160"
    + "q0 33-23.5 56.5T480-80ZM320-280h320v-280q0-66-47-113t-113-47q-66 0-113 47t-47 113v280Z";
  const FOLDER_ICON_PATH = "M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320"
    + "q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80h640v-400H447l-80-80H160v480Zm0 0v-480 480Z";
</script>

<SettingsGroup title="When download completes">
  <label class="set-item set-item-label">
    <div class="set-lead accent">
      <svg aria-hidden="true" fill="currentColor" height="20" viewBox="0 -960 960 960" width="20">
        <path d={BELL_ICON_PATH} />
      </svg>
    </div>
    <div class="set-txt">
      <span class="set-label">Notify when window is idle</span>
    </div>
    <div class="set-trail">
      <span class="set-switch">
        <input
          class="set-switch-input"
          checked={options.isNotifyOnIdle}
          onchange={e => {
            if (!(e.target instanceof HTMLInputElement)) {
              return;
            }

            void setOption({
              key: "isNotifyOnIdle",
              value: e.target.checked
            });
          }}
          role="switch"
          type="checkbox"
        />
        <span class="set-switch-track"></span>
      </span>
    </div>
  </label>
  <label class="set-item set-item-label">
    <div class="set-lead">
      <svg aria-hidden="true" fill="currentColor" height="20" viewBox="0 -960 960 960" width="20">
        <path d={FOLDER_ICON_PATH} />
      </svg>
    </div>
    <div class="set-txt">
      <span class="set-label">Reveal file in folder</span>
    </div>
    <div class="set-trail">
      <span class="set-switch">
        <input
          class="set-switch-input"
          checked={options.isRevealOnComplete}
          onchange={e => {
            if (!(e.target instanceof HTMLInputElement)) {
              return;
            }

            void setOption({
              key: "isRevealOnComplete",
              value: e.target.checked
            });
          }}
          role="switch"
          type="checkbox"
        />
        <span class="set-switch-track"></span>
      </span>
    </div>
  </label>
</SettingsGroup>

<SettingsGroup title="Integration">
  <label class="set-item set-item-label">
    <div class="set-lead accent">
      <svg aria-hidden="true" fill="currentColor" height="20" viewBox="0 -960 960 960" width="20">
        <path d="M320-200v-560l440 280-440 280Zm80-280Zm0 134 210-134-210-134v268Z" />
      </svg>
    </div>
    <div class="set-txt">
      <span class="set-label">Show native download button on watch page</span>
    </div>
    <div class="set-trail">
      <span class="set-switch">
        <input
          class="set-switch-input"
          checked={options.isShowNativeDownload}
          onchange={e => {
            if (!(e.target instanceof HTMLInputElement)) {
              return;
            }

            void setOption({
              key: "isShowNativeDownload",
              value: e.target.checked
            });
          }}
          role="switch"
          type="checkbox"
        />
        <span class="set-switch-track"></span>
      </span>
    </div>
  </label>
</SettingsGroup>

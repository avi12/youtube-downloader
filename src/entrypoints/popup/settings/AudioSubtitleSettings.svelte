<script lang="ts">
  import AudioTrackSection from "./AudioTrackSection.svelte";
  import CaptionLanguageSection from "./CaptionLanguageSection.svelte";
  import type { SlidingSettingsProps } from "./settings-types";
  import SettingsGroup from "./SettingsGroup.svelte";
  import { setOption } from "@/lib/storage/storage";

  const { options, slideDuration }: SlidingSettingsProps = $props();

  const CAPTIONS_ICON_PATH = "M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5"
    + "T880-720v480q0 33-23.5 56.5T800-160H160Zm0-80h640v-480H160v480Zm80-120h200v-80H240v80Zm240 0h240v-80H480v80Z"
    + "M240-440h80v-80h-80v80Zm160 0h80v-80h-80v80Zm160 0h80v-80h-80v80Zm80-160H240v-80h400v80Z";
  const AUDIO_VOLUME_ICON_PATH = "M560-131v-82q90-26 145-100t55-168q0-94-55-168T560-749v-82q124 28 202 125.5"
    + "T840-481q0 127-78 224.5T560-131ZM120-360v-240h160l200-200v640L280-360H120Zm440 40v-322q47 22 73.5 66"
    + "t26.5 96q0 51-26.5 94.5T560-320Z";
  const AI_CAPTIONS_ICON_PATH = "m280-80 80-172-172-80 172-80-80-172 80 172 172-80-172 80 80 172"
    + "Zm424-360-56-124-56 124-124 56 124 56 56 124 56-124 124-56-124-56Zm-284 36Z";
</script>

<SettingsGroup title="Audio &amp; subtitles">
  <label class="set-item set-item-label">
    <div class="set-lead accent">
      <svg aria-hidden="true" fill="currentColor" height="20" viewBox="0 -960 960 960" width="20">
        <path d={CAPTIONS_ICON_PATH} />
      </svg>
    </div>
    <div class="set-txt">
      <span class="set-label">Download additional audio tracks and captions</span>
    </div>
    <div class="set-trail">
      <span class="set-switch">
        <input
          class="set-switch-input"
          checked={options.downloadExtras}
          onchange={e => {
            if (!(e.target instanceof HTMLInputElement)) {
              return;
            }

            void setOption({
              key: "downloadExtras",
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
        <path d={AUDIO_VOLUME_ICON_PATH} />
      </svg>
    </div>
    <div class="set-txt">
      <span class="set-label">Include auto-dubbed audio tracks</span>
    </div>
    <div class="set-trail">
      <span class="set-switch">
        <input
          class="set-switch-input"
          checked={options.includeAutoDubbing}
          onchange={e => {
            if (!(e.target instanceof HTMLInputElement)) {
              return;
            }

            void setOption({
              key: "includeAutoDubbing",
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
        <path d={AI_CAPTIONS_ICON_PATH} />
      </svg>
    </div>
    <div class="set-txt">
      <span class="set-label">Include AI-generated captions</span>
    </div>
    <div class="set-trail">
      <span class="set-switch">
        <input
          class="set-switch-input"
          checked={options.includeAiCaptions}
          onchange={e => {
            if (!(e.target instanceof HTMLInputElement)) {
              return;
            }

            void setOption({
              key: "includeAiCaptions",
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
  <AudioTrackSection {options} {slideDuration} />
  <CaptionLanguageSection {options} />
</SettingsGroup>

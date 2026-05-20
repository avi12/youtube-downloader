<script lang="ts">
  import AudioTrackSection from "./AudioTrackSection.svelte";
  import CaptionLanguageSection from "./CaptionLanguageSection.svelte";
  import type { SlidingSettingsProps } from "./settings-types";
  import SettingsGroup from "./SettingsGroup.svelte";
  import { setOption } from "@/lib/storage/storage";
  import { AUTO_EXTENSION, MULTI_TRACK_UNSUPPORTED_EXTENSIONS } from "@/lib/utils/containers";

  const { options, slideDuration }: SlidingSettingsProps = $props();

  async function switchVideoFormatIfUnsupported(isEnabled: boolean): Promise<void> {
    if (!isEnabled || !MULTI_TRACK_UNSUPPORTED_EXTENSIONS.has(options.ext.video)) {
      return;
    }

    await setOption({
      key: "ext",
      value: {
        ...options.ext,
        video: AUTO_EXTENSION
      }
    });
  }
</script>

<SettingsGroup title="Audio &amp; subtitles">
  <label class="settings-row">
    <span class="settings-label">Download additional audio tracks and captions</span>
    <span class="settings-switch" aria-label="Download additional audio tracks and captions">
      <input
        checked={options.downloadExtras}
        onchange={async e => {
          if (!(e.target instanceof HTMLInputElement)) {
            return;
          }

          await setOption({
            key: "downloadExtras",
            value: e.target.checked
          });
          await switchVideoFormatIfUnsupported(e.target.checked);
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
    <span class="settings-label">Include auto-dubbed audio tracks</span>
    <span class="settings-switch" aria-label="Include auto-dubbed audio tracks">
      <input
        checked={options.includeAutoDubbing}
        onchange={async e => {
          if (!(e.target instanceof HTMLInputElement)) {
            return;
          }

          await setOption({
            key: "includeAutoDubbing",
            value: e.target.checked
          });
          await switchVideoFormatIfUnsupported(e.target.checked);
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
    <span class="settings-label">Include AI-generated captions</span>
    <span class="settings-switch" aria-label="Include AI-generated captions">
      <input
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
      <span class="settings-switch-track">
        <span class="settings-switch-thumb"></span>
      </span>
    </span>
  </label>
  <AudioTrackSection {options} {slideDuration} />
  <CaptionLanguageSection {options} />
</SettingsGroup>

<script lang="ts">
  import AudioTrackSection from "./AudioTrackSection.svelte";
  import CaptionLanguageSection from "./CaptionLanguageSection.svelte";
  import { setOption } from "@/lib/storage/storage";
  import type { Options } from "@/types";

  interface Props {
    options: Options;
    slideDuration: number;
  }

  const { options, slideDuration }: Props = $props();
</script>

<fieldset class="settings-group">
  <legend class="settings-legend">Audio &amp; subtitles</legend>
  <label class="settings-row">
    <span class="settings-label">Download additional audio tracks and captions</span>
    <span class="settings-switch" aria-label="Download additional audio tracks and captions">
      <input
        checked={options.downloadExtras}
        onchange={e => {
          if (e.target instanceof HTMLInputElement) {
            void setOption("downloadExtras", e.target.checked);
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
  <AudioTrackSection {options} {slideDuration} />
  <CaptionLanguageSection {options} />
</fieldset>

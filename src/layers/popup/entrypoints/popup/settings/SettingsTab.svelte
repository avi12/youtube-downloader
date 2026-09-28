<script lang="ts">
  import AudioSubtitleSettings from "./sections/AudioSubtitleSettings.svelte";
  import CompletionSettings from "./sections/CompletionSettings.svelte";
  import DownloadTypeSettings from "./sections/DownloadTypeSettings.svelte";
  import FormatSettings from "./sections/FormatSettings.svelte";
  import PlaylistSettings from "./sections/PlaylistSettings.svelte";
  import VideoQualitySettings from "./sections/VideoQualitySettings.svelte";
  import type { Options } from "@/types";

  interface Props {
    options: Options;
  }

  const { options }: Props = $props();

  const SLIDE_DURATION = 200;
</script>

<div class="settings-container">
  <FormatSettings {options} slideDuration={SLIDE_DURATION} />
  <DownloadTypeSettings {options} />
  <VideoQualitySettings {options} slideDuration={SLIDE_DURATION} />
  <PlaylistSettings {options} />
  <AudioSubtitleSettings {options} slideDuration={SLIDE_DURATION} />
  <CompletionSettings {options} />
</div>

<style>
  .settings-container {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
</style>

<script lang="ts">
  import AudioSubtitleSettings from "./AudioSubtitleSettings.svelte";
  import CompletionSettings from "./CompletionSettings.svelte";
  import DownloadTypeSettings from "./DownloadTypeSettings.svelte";
  import FormatSettings from "./FormatSettings.svelte";
  import PlaylistSettings from "./PlaylistSettings.svelte";
  import "./settings.css";
  import VideoQualitySettings from "./VideoQualitySettings.svelte";
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

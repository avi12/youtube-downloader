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
  const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let isReducedMotion = $state(prefersReducedMotion.matches);
  prefersReducedMotion.addEventListener("change", e => {
    isReducedMotion = e.matches;
  });
  const effectiveSlideDuration = $derived(isReducedMotion ? 0 : SLIDE_DURATION);
</script>

<div class="settings-container">
  <FormatSettings {options} slideDuration={effectiveSlideDuration} />
  <DownloadTypeSettings {options} />
  <VideoQualitySettings {options} slideDuration={effectiveSlideDuration} />
  <PlaylistSettings {options} />
  <AudioSubtitleSettings {options} slideDuration={effectiveSlideDuration} />
  <CompletionSettings {options} />
</div>

<style>
  .settings-container {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
</style>

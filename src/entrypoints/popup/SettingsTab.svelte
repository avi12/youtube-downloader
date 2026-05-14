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

  const reducedMotionQuery = matchMedia("(prefers-reduced-motion: reduce)");
  let prefersReducedMotion = $state(reducedMotionQuery.matches);
  const slideDuration = $derived(prefersReducedMotion ? 0 : 200);

  $effect(() => {
    function handleChange(e: MediaQueryListEvent) {
      prefersReducedMotion = e.matches;
    }

    reducedMotionQuery.addEventListener("change", handleChange);
    return () => reducedMotionQuery.removeEventListener("change", handleChange);
  });
</script>

<div class="settings-container">
  <FormatSettings {options} />
  <DownloadTypeSettings {options} />
  <VideoQualitySettings {options} {slideDuration} />
  <PlaylistSettings {options} />
  <AudioSubtitleSettings {options} {slideDuration} />
  <CompletionSettings {options} />
</div>

<style>
  .settings-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
</style>

<script lang="ts">
  import PolymerSelect from "../polymer-select/PolymerSelect.svelte";
  import type { createPlaylistDownloaderState } from "./PlaylistDownloader.state.svelte";
  import { AUTO_EXTENSION, AUTO_EXTENSION_LABEL, supportedExtensions } from "@/lib/utils/containers";
  import { videoQualities } from "@/lib/youtube/video-helpers";
  import { DownloadType, VideoQualityMode } from "@/types";

  type Props = {
    playlist: ReturnType<typeof createPlaylistDownloaderState>;
  };

  const { playlist }: Props = $props();

  function formatExtensionLabel(extension: string) {
    return extension === AUTO_EXTENSION ? AUTO_EXTENSION_LABEL : extension.toUpperCase();
  }

  const videoExtOptions = $derived(
    supportedExtensions.video.map(extension => ({
      value: extension,
      label: formatExtensionLabel(extension)
    }))
  );
  const audioExtOptions = $derived(
    supportedExtensions.audio.map(extension => ({
      value: extension,
      label: formatExtensionLabel(extension)
    }))
  );

  const qualityOptions = $derived([
    {
      value: VideoQualityMode.Best,
      label: "Best quality"
    },
    ...videoQualities
      .filter(height => !playlist.maxAvailableQuality || height <= playlist.maxAvailableQuality)
      .map(height => ({
        value: String(height),
        label: !playlist.isRevealingAll && height <= playlist.guaranteedQuality ? `${height}p` : `Up to ${height}p`
      }))
  ]);

  const isVideoTypeDisabled = $derived(playlist.effectiveDownloadType === DownloadType.Audio);
  const isAudioExtTypeDisabled = $derived(playlist.effectiveDownloadType === DownloadType.Video);
  const isVideoExtDisabled = $derived(isVideoTypeDisabled || playlist.isDownloading);
  const isAudioExtDisabled = $derived(isAudioExtTypeDisabled || playlist.isDownloading);
  const isQualityDisabled = $derived(isVideoTypeDisabled || playlist.isDownloading);

  function handleVideoExtChange(value: string) {
    playlist.effectiveVideoExt = value;
  }

  function handleAudioExtChange(value: string) {
    playlist.effectiveAudioExt = value;
  }

  function handleQualityChange(value: string) {
    playlist.effectiveQuality = value;
  }
</script>

<section class="ytdl-section ytdl-section-select" class:is-disabled={isVideoTypeDisabled}>
  <PolymerSelect
    id="playlist-video-quality"
    disabled={isQualityDisabled}
    label="Video quality"
    onchange={handleQualityChange}
    options={qualityOptions}
    value={playlist.effectiveQuality}
  />
  {#if playlist.isQualityOverridden}
    <span class="ytdl-override-badge ytdl-override-badge-floating" role="status">
      <span class="ytdl-override-dot" aria-hidden="true"></span>
      <span class="ytdl-visually-hidden">customized</span>
    </span>
  {/if}
</section>

<section class="ytdl-section ytdl-section-select" class:is-disabled={isVideoTypeDisabled}>
  <PolymerSelect
    id="playlist-video-ext"
    disabled={isVideoExtDisabled}
    label="Video format"
    onchange={handleVideoExtChange}
    options={videoExtOptions}
    value={playlist.effectiveVideoExt}
  />
  {#if playlist.isVideoExtOverridden}
    <span class="ytdl-override-badge ytdl-override-badge-floating" role="status">
      <span class="ytdl-override-dot" aria-hidden="true"></span>
      <span class="ytdl-visually-hidden">customized</span>
    </span>
  {/if}
</section>

<section class="ytdl-section ytdl-section-select" class:is-disabled={isAudioExtTypeDisabled}>
  <PolymerSelect
    id="playlist-audio-ext"
    disabled={isAudioExtDisabled}
    label="Audio format"
    onchange={handleAudioExtChange}
    options={audioExtOptions}
    value={playlist.effectiveAudioExt}
  />
  {#if playlist.isAudioExtOverridden}
    <span class="ytdl-override-badge ytdl-override-badge-floating" role="status">
      <span class="ytdl-override-dot" aria-hidden="true"></span>
      <span class="ytdl-visually-hidden">customized</span>
    </span>
  {/if}
</section>

{#if playlist.isAnyOverrideActive}
  <button class="ytdl-reset-link" disabled={playlist.isDownloading} onclick={playlist.resetOverrides} type="button">
    Reset to my defaults
  </button>
{/if}

<style>
  :global {
    .ytdl-section-select {
      position: relative;
    }

    .ytdl-section.is-disabled {
      opacity: 50%;
      pointer-events: none;
    }

    .ytdl-override-badge {
      display: inline-flex;
      align-items: center;
    }

    .ytdl-override-badge-floating {
      position: absolute;
      top: 14px;
      right: -12px;
    }

    .ytdl-override-dot {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--yt-spec-call-to-action, #3ea6ff);
    }

    .ytdl-visually-hidden {
      position: absolute;
      overflow: hidden;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      border: 0;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }

  .ytdl-reset-link {
    align-self: flex-start;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--yt-spec-call-to-action, #3ea6ff);
    font-family: inherit;
    font-size: 1.2rem;
    cursor: pointer;

    &:hover {
      text-decoration: underline;
    }
  }
</style>

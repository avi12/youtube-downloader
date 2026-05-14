<script lang="ts">
  import PolymerSelect from "../polymer-select/PolymerSelect.svelte";
  import { formatExtensionLabel } from "./helpers/PlaylistDownloaderFormatSections.helpers";
  import type { createPlaylistDownloaderState } from "./PlaylistDownloader.state.svelte";
  import PlaylistOverrideBadge from "./PlaylistOverrideBadge.svelte";
  import { supportedExtensions } from "@/lib/utils/containers";
  import { DownloadType, VideoQualityMode } from "@/types";

  interface Props {
    playlist: ReturnType<typeof createPlaylistDownloaderState>;
  }

  const { playlist }: Props = $props();

  const videoExtOptions = $derived(
    supportedExtensions.video.map(ext => ({
      value: ext,
      label: formatExtensionLabel(ext)
    }))
  );
  const audioExtOptions = $derived(
    supportedExtensions.audio.map(ext => ({
      value: ext,
      label: formatExtensionLabel(ext)
    }))
  );
  const qualityOptions = $derived([
    {
      value: VideoQualityMode.Best,
      label: "Best quality"
    },
    ...playlist.availableQualities.map(height => ({
      value: String(height),
      label: !playlist.isRevealingAll && height <= playlist.guaranteedQuality ? `${height}p` : `Up to ${height}p`
    }))
  ]);

  const isVideoTypeDisabled = $derived(playlist.effectiveDownloadType === DownloadType.Audio);
  const isAudioExtTypeDisabled = $derived(playlist.effectiveDownloadType === DownloadType.Video);
  const isVideoExtDisabled = $derived(isVideoTypeDisabled || playlist.isDownloading);
  const isAudioExtDisabled = $derived(isAudioExtTypeDisabled || playlist.isDownloading);
  const isQualityDisabled = $derived(isVideoTypeDisabled || playlist.isDownloading);
</script>

<div class="ytdl-section ytdl-section-select" class:is-disabled={isVideoTypeDisabled}>
  <PolymerSelect
    id="playlist-video-quality"
    disabled={isQualityDisabled}
    label="Video quality"
    onchange={value => (playlist.effectiveQuality = value)}
    options={qualityOptions}
    value={playlist.effectiveQuality}
  />
  {#if playlist.isQualityOverridden}<PlaylistOverrideBadge />{/if}
</div>

<div class="ytdl-section ytdl-section-select" class:is-disabled={isVideoTypeDisabled}>
  <PolymerSelect
    id="playlist-video-ext"
    disabled={isVideoExtDisabled}
    label="Video format"
    onchange={value => (playlist.effectiveVideoExt = value)}
    options={videoExtOptions}
    value={playlist.effectiveVideoExt}
  />
  {#if playlist.isVideoExtOverridden}<PlaylistOverrideBadge />{/if}
</div>

<div class="ytdl-section ytdl-section-select" class:is-disabled={isAudioExtTypeDisabled}>
  <PolymerSelect
    id="playlist-audio-ext"
    disabled={isAudioExtDisabled}
    label="Audio format"
    onchange={value => (playlist.effectiveAudioExt = value)}
    options={audioExtOptions}
    value={playlist.effectiveAudioExt}
  />
  {#if playlist.isAudioExtOverridden}<PlaylistOverrideBadge />{/if}
</div>

{#if playlist.isAnyOverrideActive}
  <button class="ytdl-reset-link" disabled={playlist.isDownloading} onclick={playlist.resetOverrides} type="button">
    Reset to my defaults
  </button>
{/if}

<style>
  .ytdl-section-select {
    position: relative;
  }

  .ytdl-section.is-disabled {
    opacity: 50%;
    pointer-events: none;
  }

  :global(.ytdl-section-select .ytdl-override-badge) {
    position: absolute;
    top: 14px;
    right: -12px;
  }

  .ytdl-reset-link {
    align-self: flex-start;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--yt-sys-color-baseline--call-to-action, #3ea6ff);
    font-family: inherit;
    font-size: 1.2rem;
    cursor: pointer;

    &:hover {
      text-decoration: underline;
    }
  }
</style>

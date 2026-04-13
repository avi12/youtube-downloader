<script lang="ts">
  import type { createPlaylistDownloaderState } from "./PlaylistDownloader.state.svelte";
  import PolymerSelect from "./PolymerSelect.svelte";
  import { AUTO_EXTENSION, AUTO_EXTENSION_LABEL, supportedExtensions } from "@/lib/containers";
  import { DownloadType } from "@/types";

  type Props = { playlist: ReturnType<typeof createPlaylistDownloaderState> };

  const { playlist }: Props = $props();

  function formatExtensionLabel(extension: string) {
    return extension === AUTO_EXTENSION ? AUTO_EXTENSION_LABEL : extension.toUpperCase();
  }

  const videoExtOptions = $derived(
    supportedExtensions.video.map(extension => ({ value: extension, label: formatExtensionLabel(extension) }))
  );
  const audioExtOptions = $derived(
    supportedExtensions.audio.map(extension => ({ value: extension, label: formatExtensionLabel(extension) }))
  );

  const isVideoExtDisabled = $derived(playlist.effectiveDownloadType === DownloadType.Audio);
  const isAudioExtDisabled = $derived(playlist.effectiveDownloadType === DownloadType.Video);

  function handleVideoExtChange(value: string) {
    playlist.effectiveVideoExt = value;
  }

  function handleAudioExtChange(value: string) {
    playlist.effectiveAudioExt = value;
  }
</script>

<section class="ytdl-section ytdl-section-select" class:is-disabled={isVideoExtDisabled}>
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

<section class="ytdl-section ytdl-section-select" class:is-disabled={isAudioExtDisabled}>
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

{#if playlist.hasAnyOverride}
  <button class="ytdl-reset-link" onclick={playlist.resetOverrides} type="button">
    Reset to my defaults
  </button>
{/if}

<style>
  :global(.ytdl-section-select) {
    position: relative;
  }

  :global(.ytdl-section.is-disabled) {
    opacity: 50%;
    pointer-events: none;
  }

  :global(.ytdl-override-badge) {
    display: inline-flex;
    align-items: center;
  }

  :global(.ytdl-override-badge-floating) {
    position: absolute;
    top: 14px;
    right: -12px;
  }

  :global(.ytdl-override-dot) {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--yt-spec-call-to-action, #3ea6ff);
  }

  :global(.ytdl-visually-hidden) {
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

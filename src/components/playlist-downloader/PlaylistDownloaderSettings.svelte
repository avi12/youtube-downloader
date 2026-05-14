<script lang="ts">
  import type { createPlaylistDownloaderState } from "./PlaylistDownloader.state.svelte";
  import type { createPlaylistToggleButtons } from "./PlaylistDownloader.toggle-buttons.svelte";
  import PlaylistOverrideBadge from "./PlaylistOverrideBadge.svelte";
  import PlaylistZipNameInput from "./PlaylistZipNameInput.svelte";
  import { PlaylistOutputMode } from "@/types";

  interface Props {
    playlist: ReturnType<typeof createPlaylistDownloaderState>;
    toggleButtons: ReturnType<typeof createPlaylistToggleButtons>;
  }

  const { playlist, toggleButtons }: Props = $props();
</script>

<section class="ytdl-section" aria-labelledby="ytdl-speed-label">
  <h3 id="ytdl-speed-label" class="ytdl-section-title">Speed</h3>
  <div class="ytdl-chip-row" aria-labelledby="ytdl-speed-label" role="group">
    {#each toggleButtons.groups.speed as button (button.id)}
      <yt-button-view-model {@attach toggleButtons.createAttacher(button)}></yt-button-view-model>
    {/each}
  </div>
</section>

<section class="ytdl-section" aria-labelledby="ytdl-output-label">
  <h3 id="ytdl-output-label" class="ytdl-section-title">Output</h3>
  <div class="ytdl-chip-row" aria-labelledby="ytdl-output-label" role="group">
    {#each toggleButtons.groups.output as button (button.id)}
      <yt-button-view-model {@attach toggleButtons.createAttacher(button)}></yt-button-view-model>
    {/each}
  </div>
  {#if playlist.outputMode === PlaylistOutputMode.Zip}
    <PlaylistZipNameInput
      isDisabled={playlist.isDownloading}
      isOverridden={playlist.isZipNameOverridden}
      onchange={value => (playlist.effectiveZipName = value)}
      value={playlist.effectiveZipName}
    />
  {/if}
</section>

<section class="ytdl-section" aria-labelledby="ytdl-type-label">
  <h3 id="ytdl-type-label" class="ytdl-section-title">
    Type
    {#if playlist.isDownloadTypeOverridden}
      <PlaylistOverrideBadge />
    {/if}
  </h3>
  <div class="ytdl-chip-row ytdl-chip-row-wrap" aria-labelledby="ytdl-type-label" role="group">
    {#each toggleButtons.groups.type as button (button.id)}
      <yt-button-view-model {@attach toggleButtons.createAttacher(button)}></yt-button-view-model>
    {/each}
  </div>
</section>

<style>
  .ytdl-section-title {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    margin: 0;
    font-weight: 500;
    font-size: 1.4rem;
    line-height: 1.2;
  }

  .ytdl-chip-row {
    display: flex;
    gap: 6px;
  }

  .ytdl-chip-row-wrap {
    flex-wrap: wrap;
  }
</style>

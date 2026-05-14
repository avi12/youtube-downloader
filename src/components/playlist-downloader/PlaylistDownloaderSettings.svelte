<script lang="ts">
  import type { createPlaylistDownloaderState } from "./PlaylistDownloader.state.svelte";
  import type { createPlaylistToggleButtons } from "./PlaylistDownloader.toggle-buttons.svelte";
  import PlaylistOverrideBadge from "./PlaylistOverrideBadge.svelte";
  import PlaylistZipNameInput from "./PlaylistZipNameInput.svelte";
  import { attachFormattedString, attachSettingsOptions } from "@/lib/ui/polymer-utils";
  import { PlaylistOutputMode } from "@/types";

  interface Props {
    playlist: ReturnType<typeof createPlaylistDownloaderState>;
    toggleButtons: ReturnType<typeof createPlaylistToggleButtons>;
  }

  const { playlist, toggleButtons }: Props = $props();
</script>

<ytd-settings-options-renderer class="ytdl-section" {@attach attachSettingsOptions("Speed")}>
  <div
    class="ytdl-seg"
    aria-label="Speed"
    onkeydown={toggleButtons.speedKeydown}
    role="radiogroup"
    tabindex="-1"
  >
    {#each toggleButtons.groups.speed as button (button.id)}
      <yt-button-view-model
        {@attach toggleButtons.createAttacher(button)}
        data-ytdl-button-id={button.id}
      ></yt-button-view-model>
    {/each}
  </div>
</ytd-settings-options-renderer>

<ytd-settings-options-renderer class="ytdl-section" {@attach attachSettingsOptions("Output")}>
  <div
    class="ytdl-seg"
    aria-label="Output"
    onkeydown={toggleButtons.outputKeydown}
    role="radiogroup"
    tabindex="-1"
  >
    {#each toggleButtons.groups.output as button (button.id)}
      <yt-button-view-model
        {@attach toggleButtons.createAttacher(button)}
        data-ytdl-button-id={button.id}
      ></yt-button-view-model>
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
</ytd-settings-options-renderer>

<div class="ytdl-section">
  <div id="ytdl-type-label" class="ytdl-section-title">
    <yt-formatted-string {@attach attachFormattedString} data-ytdl-text="Type"></yt-formatted-string>
    {#if playlist.isDownloadTypeOverridden}
      <PlaylistOverrideBadge />
    {/if}
  </div>
  <div class="ytdl-chip-row ytdl-chip-row-wrap" aria-labelledby="ytdl-type-label" role="group">
    {#each toggleButtons.groups.type as button (button.id)}
      <yt-button-view-model {@attach toggleButtons.createAttacher(button)}></yt-button-view-model>
    {/each}
  </div>
</div>

<style>
  .ytdl-section-title {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    font-weight: 500;
    font-size: 1.4rem;
    line-height: 1.2;
  }

  .ytdl-seg {
    display: inline-flex;
    flex-shrink: 0;
    gap: 2px;
    align-items: center;
    align-self: flex-start;
    padding: 2px;
    border: 1px solid var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 10%));
    border-radius: 999px;
    background: var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 8%));
  }

  .ytdl-chip-row {
    display: flex;
    gap: 6px;
  }

  .ytdl-chip-row-wrap {
    flex-wrap: wrap;
  }
</style>

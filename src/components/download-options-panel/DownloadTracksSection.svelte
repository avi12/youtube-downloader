<script lang="ts">
  import TrackChoice from "./TrackChoice.svelte";
  import { attachFormattedString } from "@/lib/ui/polymer-utils";
  import { PanelTrackMode, TrackKind } from "@/types";
  import type { CaptionTrack, LabeledOption } from "@/types";

  interface Props {
    uniqueAudioLanguages: LabeledOption[];
    captionTracks: CaptionTrack[];
    isDownloading: boolean;
    downloadExtras: boolean;
    panelAudioMode: PanelTrackMode;
    panelAudioCustomLanguage: string;
    audioPlayerLabel: string | null;
    audioOriginalLabel: string | null;
    panelCaptionMode: PanelTrackMode;
    captionCustomOptions: LabeledOption[];
    selectedCaptionVssId: string;
    captionPlayerLabel: string | null;
    captionOriginalLabel: string | null;
    onaudiomodechange: (mode: PanelTrackMode) => void;
    onaudiocustomchange: (langCode: string) => void;
    oncaptionmodechange: (mode: PanelTrackMode) => void;
    oncaptionchange: (vssId: string) => void;
  }

  const {
    uniqueAudioLanguages,
    captionTracks,
    isDownloading,
    downloadExtras,
    panelAudioMode,
    panelAudioCustomLanguage,
    audioPlayerLabel,
    audioOriginalLabel,
    panelCaptionMode,
    captionCustomOptions,
    selectedCaptionVssId,
    captionPlayerLabel,
    captionOriginalLabel,
    onaudiomodechange,
    onaudiocustomchange,
    oncaptionmodechange,
    oncaptionchange
  }: Props = $props();
</script>

{#if uniqueAudioLanguages.length > 0 || captionTracks.length > 0}
  <div class="ytdl-section">
    <yt-formatted-string class="ytdl-section-label" {@attach attachFormattedString("Tracks")}></yt-formatted-string>
    <TrackChoice
      customOptions={uniqueAudioLanguages}
      customValue={panelAudioCustomLanguage}
      disabled={isDownloading || uniqueAudioLanguages.length === 0}
      kind={TrackKind.Audio}
      mode={panelAudioMode}
      oncustomchange={onaudiocustomchange}
      onmodechange={onaudiomodechange}
      originalLabel={audioOriginalLabel}
      playerLabel={audioPlayerLabel}
    />
    {#if downloadExtras && uniqueAudioLanguages.length > 1}
      <yt-formatted-string
        class="ytdl-extras-note"
        {@attach attachFormattedString("Selected track is the default — all others are bundled as extras")}
      ></yt-formatted-string>
    {/if}
    <TrackChoice
      customOptions={captionCustomOptions}
      customValue={selectedCaptionVssId}
      disabled={isDownloading || captionTracks.length === 0}
      kind={TrackKind.Captions}
      mode={panelCaptionMode}
      oncustomchange={oncaptionchange}
      onmodechange={oncaptionmodechange}
      originalLabel={captionOriginalLabel}
      playerLabel={captionPlayerLabel}
    />
  </div>
{/if}

<style>
  .ytdl-extras-note {
    display: block;
    color: var(--yt-sys-color-baseline--text-secondary, #606060);
    font-size: 1.2rem;
  }
</style>

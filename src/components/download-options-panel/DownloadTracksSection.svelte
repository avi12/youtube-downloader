<script lang="ts">
  import TrackChoice from "./TrackChoice.svelte";
  import { PanelTrackMode, TrackKind } from "@/types";
  import type { CaptionTrack, LabeledOption } from "@/types";

  interface Props {
    uniqueAudioLanguages: LabeledOption[];
    captionTracks: CaptionTrack[];
    isDownloading: boolean;
    downloadExtras: boolean;
    includeAiCaptions: boolean;
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
    includeAiCaptions,
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

  const SINGLE_CAPTION_DISABLED_MODES = [PanelTrackMode.MatchVideo, PanelTrackMode.Custom];
  const ONLY_ASR_DISABLED_MODES = [PanelTrackMode.Original, PanelTrackMode.Custom];

  // Global AI off but the user's player has an ASR selected: the only caption
  // surfaced in `captionTracks` is the preserved one. Only Match-video mode is
  // meaningful (it reflects the player's choice).
  const isOnlyAsrCaption = $derived(
    captionTracks.length > 0
    && captionTracks.every(track => track.kind === "asr")
    && !includeAiCaptions
  );
  const isSingleCaption = $derived(captionTracks.length === 1 && !isOnlyAsrCaption);

  const captionDisabledModes = $derived.by(() => {
    if (isOnlyAsrCaption) {
      return ONLY_ASR_DISABLED_MODES;
    }

    if (isSingleCaption) {
      return SINGLE_CAPTION_DISABLED_MODES;
    }

    return [];
  });
  const captionForcedMode = $derived.by(() => {
    if (isOnlyAsrCaption) {
      return PanelTrackMode.MatchVideo;
    }

    if (isSingleCaption) {
      return PanelTrackMode.Original;
    }

    return panelCaptionMode;
  });
</script>

<div
  class="ytdl-tracks-section-host"
  class:is-open={uniqueAudioLanguages.length > 1 || captionTracks.length > 0}
>
  <div class="ytdl-section ytdl-tracks-section">
    <span class="ytdl-section-label">Tracks</span>
    <div class="ytdl-collapse-row" class:is-open={uniqueAudioLanguages.length > 1}>
      <div class="ytdl-collapse-row-inner">
        <TrackChoice
          customOptions={uniqueAudioLanguages}
          customValue={panelAudioCustomLanguage}
          disabled={isDownloading}
          kind={TrackKind.Audio}
          mode={panelAudioMode}
          oncustomchange={onaudiocustomchange}
          onmodechange={onaudiomodechange}
          originalLabel={audioOriginalLabel}
          playerLabel={audioPlayerLabel}
        />
        {#if downloadExtras}
          <span class="ytdl-extras-note">
            Selected track is the default - all others are bundled as extras
          </span>
        {/if}
      </div>
    </div>
    <div class="ytdl-collapse-row" class:is-open={captionTracks.length > 0}>
      <div class="ytdl-collapse-row-inner">
        <TrackChoice
          customOptions={captionCustomOptions}
          customValue={selectedCaptionVssId}
          disabled={isDownloading}
          disabledModes={captionDisabledModes}
          kind={TrackKind.Captions}
          mode={captionForcedMode}
          oncustomchange={oncaptionchange}
          onmodechange={oncaptionmodechange}
          originalLabel={captionOriginalLabel}
          playerLabel={captionPlayerLabel}
        />
      </div>
    </div>
  </div>
</div>

<style>
  .ytdl-tracks-section-host {
    display: grid;
    grid-template-rows: minmax(0, 0fr);
    overflow: hidden;
    transition: grid-template-rows 300ms cubic-bezier(0.33, 1, 0.68, 1);

    &.is-open {
      grid-template-rows: minmax(0, 1fr);
    }
  }

  .ytdl-tracks-section {
    gap: 0;
    overflow: hidden;
    box-sizing: border-box;
    min-height: 0;
    padding-top: 16px;

    & > :global(*:not(:first-child)) {
      margin-top: 8px;
    }
  }

  .ytdl-collapse-row {
    display: grid;
    grid-template-rows: minmax(0, 0fr);
    transition: grid-template-rows 300ms cubic-bezier(0.33, 1, 0.68, 1);

    &.is-open {
      grid-template-rows: minmax(0, 1fr);
    }
  }

  .ytdl-tracks-section > .ytdl-collapse-row {
    margin-top: 0;
  }

  .ytdl-collapse-row-inner {
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow: hidden;
    min-height: 0;
    padding-top: 8px;
  }

  .ytdl-extras-note {
    display: block;
    color: var(--yt-sys-color-baseline--text-secondary, #606060);
    font-size: 1.2rem;
  }
</style>

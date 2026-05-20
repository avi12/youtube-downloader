<script lang="ts">
  import DownloadMediaSection from "./DownloadMediaSection.svelte";
  import { createDownloadOptionsState, type DownloadOptionsProps } from "./DownloadOptions.state.svelte";
  import DownloadOutputSection from "./DownloadOutputSection.svelte";
  import DownloadTracksSection from "./DownloadTracksSection.svelte";
  import { PanelTrackMode } from "@/types";
  import type { AdaptiveFormatItem, CaptionTrack } from "@/types";

  interface Props extends DownloadOptionsProps {
    panelAudioMode: PanelTrackMode;
    panelAudioCustomLanguage: string;
    panelCaptionMode: PanelTrackMode;
    filename: string;
    extension: string;
    actualExtension: string;
    isDownloading: boolean;
    ondownloadtypechange: (type: import("@/types").DownloadType) => void;
    onvideoformatchange: (format: AdaptiveFormatItem) => void;
    onaudioformatchange: (format: AdaptiveFormatItem) => void;
    onaudiomodechange: (mode: PanelTrackMode) => void;
    onaudiocustomchange: (langCode: string) => void;
    oncaptionmodechange: (mode: PanelTrackMode) => void;
    oncaptionchange: (track: CaptionTrack | null) => void;
    onfilenamechange: (filename: string) => void;
    onextensionchange: (extension: string) => void;
    onvalidationchange: (isValid: boolean) => void;
  }

  const {
    downloadType, videoFormats, audioFormats, captionTracks,
    selectedVideoFormat, selectedAudioFormat, selectedCaptionTrack,
    panelAudioMode, panelAudioCustomLanguage, panelCaptionMode,
    filename, extension, actualExtension, isDownloading,
    ondownloadtypechange, onvideoformatchange, onaudioformatchange,
    onaudiomodechange, onaudiocustomchange, oncaptionmodechange,
    oncaptionchange, onfilenamechange, onextensionchange, onvalidationchange
  }: Props = $props();

  const derived = createDownloadOptionsState(() => ({
    downloadType,
    videoFormats,
    audioFormats,
    captionTracks,
    selectedVideoFormat,
    selectedAudioFormat,
    selectedCaptionTrack
  }));
</script>

<div class="ytdl-options-container">
  <DownloadMediaSection
    {audioFormats}
    {downloadType}
    isAudio={derived.isAudio}
    {isDownloading}
    {onaudioformatchange}
    {ondownloadtypechange}
    {onvideoformatchange}
    qualityOptions={derived.qualityOptions}
    qualityValue={derived.qualityValue}
    {videoFormats}
  />
  <DownloadTracksSection
    audioOriginalLabel={derived.audioOriginalLabel}
    audioPlayerLabel={derived.audioPlayerLabel}
    captionCustomOptions={derived.captionCustomOptions}
    captionOriginalLabel={derived.captionOriginalLabel}
    captionPlayerLabel={derived.captionPlayerLabel}
    captionTracks={derived.filteredCaptionTracks}
    downloadExtras={derived.downloadExtras}
    hasExtrasToBundle={derived.hasExtrasToBundle}
    includeAiCaptions={derived.includeAiCaptions}
    {isDownloading}
    {onaudiocustomchange}
    {onaudiomodechange}
    oncaptionchange={vssId =>
      oncaptionchange(derived.filteredCaptionTracks.find(track => track.vssId === vssId) ?? null)}
    {oncaptionmodechange}
    ondownloadextraschange={derived.setDownloadExtras}
    {panelAudioCustomLanguage}
    {panelAudioMode}
    {panelCaptionMode}
    selectedCaptionVssId={derived.selectedCaptionVssId}
    uniqueAudioLanguages={derived.uniqueAudioLanguages}
  />
  <DownloadOutputSection
    {actualExtension}
    {downloadType}
    {extension}
    {filename}
    {isDownloading}
    isMultiTrack={derived.hasExtrasToBundle}
    {onextensionchange}
    {onfilenamechange}
    {onvalidationchange}
  />
</div>

<style>
  .ytdl-options-container {
    display: flex;
    flex-direction: column;
    padding-bottom: 4px;
  }

  .ytdl-options-container > :global(*:not(:first-child)) {
    margin-top: 16px;
  }

  .ytdl-options-container > :global(.ytdl-tracks-section-host) {
    margin-top: 0;
  }
</style>

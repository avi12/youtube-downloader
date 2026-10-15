<script lang="ts">
  import DownloadMediaSection from "./DownloadMediaSection.svelte";
  import DownloadOutputSection from "./DownloadOutputSection.svelte";
  import DownloadTracksSection from "./DownloadTracksSection.svelte";
  import {
    createDownloadOptionsState,
    type DownloadOptionsProps
  } from "@/lib/download-options/DownloadOptions.state.svelte.ts";
  import { PanelTrackMode } from "@/types";
  import type { AdaptiveFormatItem, CaptionTrack } from "@/types";

  interface Props extends DownloadOptionsProps {
    panelAudioMode: PanelTrackMode;
    panelAudioCustomLanguage: string;
    panelCaptionMode: PanelTrackMode;
    filename: string;
    extension: string;
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
    downloadType, videoFormats, videoFormatVariants, audioFormats, captionTracks, translationLanguages,
    selectedVideoFormat, selectedAudioFormat, selectedCaptionTrack,
    panelAudioMode, panelAudioCustomLanguage, panelCaptionMode,
    filename, extension, actualExtension, codecPreferences, isDownloading,
    ondownloadtypechange, onvideoformatchange, onaudioformatchange,
    onaudiomodechange, onaudiocustomchange, oncaptionmodechange,
    oncaptionchange, onfilenamechange, onextensionchange, onvalidationchange
  }: Props = $props();

  const derived = createDownloadOptionsState(() => ({
    downloadType,
    videoFormats,
    videoFormatVariants,
    actualExtension,
    codecPreferences,
    audioFormats,
    captionTracks,
    translationLanguages,
    selectedVideoFormat,
    selectedAudioFormat,
    selectedCaptionTrack
  }));

  function handleExtensionChange(newExtension: string): void {
    derived.guardExtrasForExtension(newExtension);
    onextensionchange(newExtension);
  }
</script>

<div class="ytdl-options-container">
  <DownloadMediaSection
    audioCodecOptions={derived.audioCodecOptions}
    audioCodecValue={derived.audioCodecValue}
    {audioFormats}
    {downloadType}
    isAudio={derived.isAudio}
    {isDownloading}
    {onaudioformatchange}
    {ondownloadtypechange}
    {onvideoformatchange}
    qualityOptions={derived.qualityOptions}
    qualityValue={derived.qualityValue}
    videoCodecOptions={derived.videoCodecOptions}
    videoCodecValue={derived.videoCodecValue}
    videoFormatVariants={derived.videoFormatVariants}
  />
  <DownloadTracksSection
    audioOriginalLabel={derived.audioOriginalLabel}
    audioPlayerLabel={derived.audioPlayerLabel}
    captionCustomOptions={derived.captionCustomOptions}
    captionOriginalLabel={derived.captionOriginalLabel}
    captionPlayerLabel={derived.captionPlayerLabel}
    captionTracks={derived.filteredCaptionTracks}
    downloadExtraCaptions={derived.downloadExtraCaptions}
    downloadExtras={derived.downloadExtras}
    {downloadType}
    {extension}
    {isDownloading}
    isExtrasAutoDisabled={derived.isExtrasAutoDisabled}
    {onaudiocustomchange}
    {onaudiomodechange}
    oncaptionchange={vssId => oncaptionchange(derived.findCaptionTrack(vssId))}
    {oncaptionmodechange}
    ondownloadextracaptionschange={derived.setDownloadExtraCaptions}
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
    isMultiTrack={false}
    onextensionchange={handleExtensionChange}
    {onfilenamechange}
    {onvalidationchange}
  />
</div>

<style>
  .ytdl-options-container {
    display: flex;
    flex-direction: column;
    padding-bottom: 4px;

    > :global(*:not(:first-child)) {
      margin-top: 16px;
    }
  }
</style>

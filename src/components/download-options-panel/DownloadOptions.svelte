<script lang="ts">
  import DownloadMediaSection from "./DownloadMediaSection.svelte";
  import { createDownloadOptionsState, type DownloadOptionsProps } from "./DownloadOptions.state.svelte";
  import DownloadOutputSection from "./DownloadOutputSection.svelte";
  import DownloadTracksSection from "./DownloadTracksSection.svelte";
  import { MULTI_TRACK_UNSUPPORTED_EXTENSIONS } from "@/lib/utils/containers";
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
    downloadType, videoFormats, audioFormats, captionTracks, translationLanguages,
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
    translationLanguages,
    selectedVideoFormat,
    selectedAudioFormat,
    selectedCaptionTrack
  }));

  let isExtrasAutoDisabled = $state(false);

  function handleExtensionChange(newExtension: string): void {
    const isIncompatible = MULTI_TRACK_UNSUPPORTED_EXTENSIONS.has(newExtension);
    const isExtrasIncompatible = isIncompatible && derived.downloadExtras && derived.uniqueAudioLanguages.length > 1;
    if (isExtrasIncompatible) {
      derived.setDownloadExtras(false);
      isExtrasAutoDisabled = true;
    } else {
      isExtrasAutoDisabled = false;
    }

    onextensionchange(newExtension);
  }
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
    downloadExtraCaptions={derived.downloadExtraCaptions}
    downloadExtras={derived.downloadExtras}
    {downloadType}
    {extension}
    {isDownloading}
    {isExtrasAutoDisabled}
    {onaudiocustomchange}
    {onaudiomodechange}
    oncaptionchange={vssId => {
      const native = derived.filteredCaptionTracks.find(track => track.vssId === vssId);
      if (native) {
        oncaptionchange(native); return;
      }

      oncaptionchange(derived.translatedCaptionTracks.find(track => track.vssId === vssId) ?? null);
    }}
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

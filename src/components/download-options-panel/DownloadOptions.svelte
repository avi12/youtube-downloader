<script lang="ts">
  import PolymerSelect from "../polymer-select/PolymerSelect.svelte";
  import TrackChoice from "./TrackChoice.svelte";
  import { splitFilenameAndExtension, supportedExtensions } from "@/lib/utils/containers";
  import {
    findOriginalAudioFormat,
    formatAudioCodecLabel,
    formatVideoQualityLabel,
    normalizeLanguageCode
  } from "@/lib/youtube/video-helpers";
  import { DownloadType, PanelTrackMode, TrackKind } from "@/types";
  import type { AdaptiveFormatItem, CaptionTrack } from "@/types";
  import { SvelteSet } from "svelte/reactivity";

  interface Props {
    downloadType: DownloadType;
    videoFormats: AdaptiveFormatItem[];
    audioFormats: AdaptiveFormatItem[];
    captionTracks: CaptionTrack[];
    selectedVideoFormat: AdaptiveFormatItem | null;
    selectedAudioFormat: AdaptiveFormatItem | null;
    selectedCaptionTrack: CaptionTrack | null;
    panelAudioMode: PanelTrackMode;
    panelAudioCustomLanguage: string;
    panelCaptionMode: PanelTrackMode;
    filename: string;
    extension: string;
    isDownloading: boolean;
    downloadExtras: boolean;
    ondownloadtypechange: (type: DownloadType) => void;
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
    downloadType,
    videoFormats,
    audioFormats,
    captionTracks,
    selectedVideoFormat,
    selectedAudioFormat,
    selectedCaptionTrack,
    panelAudioMode,
    panelAudioCustomLanguage,
    panelCaptionMode,
    filename,
    extension,
    isDownloading,
    downloadExtras,
    ondownloadtypechange,
    onvideoformatchange,
    onaudioformatchange,
    onaudiomodechange,
    onaudiocustomchange,
    oncaptionmodechange,
    oncaptionchange,
    onfilenamechange,
    onextensionchange,
    onvalidationchange
  }: Props = $props();

  const extensionType = $derived(downloadType === DownloadType.Audio ? DownloadType.Audio : DownloadType.Video);
  const fullFilename = $derived(`${filename}.${extension}`);

  function getFilenameError({ value, type }: {
    value: string;
    type: typeof DownloadType.Video | typeof DownloadType.Audio;
  }) {
    const illegalMatch = value.match(/[<>:"/\\|?*]/);
    if (illegalMatch) {
      return `Character "${illegalMatch[0]}" isn't allowed in filenames`;
    }

    const { name, extension } = splitFilenameAndExtension(value);
    if (!name.trim()) {
      return "Filename can't be empty";
    }

    const ext = extension.toLowerCase();
    if (!ext) {
      return "Filename needs a file extension";
    }

    const validExtensions = supportedExtensions[type];
    if (!validExtensions.includes(ext)) {
      return `Extension .${ext} isn't supported for ${type} - try ${validExtensions.join(", ")}`;
    }

    return "";
  }

  const filenameValidationError = $derived(
    getFilenameError({
      value: fullFilename,
      type: extensionType
    })
  );
  const isFilenameValid = $derived(!filenameValidationError);

  $effect(() => {
    onvalidationchange(isFilenameValid);
  });

  const DOWNLOAD_TYPES: {
    value: DownloadType;
    label: string;
  }[] = [
    {
      value: DownloadType.VideoAndAudio,
      label: "Video + Audio"
    },
    {
      value: DownloadType.Video,
      label: "Video only"
    },
    {
      value: DownloadType.Audio,
      label: "Audio only"
    }
  ];

  const isAudio = $derived(downloadType === DownloadType.Audio);

  const uniqueAudioLanguages = $derived.by(() => {
    const seen = new SvelteSet<string>();
    const result: {
      value: string;
      label: string;
    }[] = [];
    for (const format of audioFormats) {
      if (!format.audioTrack) {
        continue;
      }

      const langCode = normalizeLanguageCode(format.audioTrack.id);
      if (seen.has(langCode)) {
        continue;
      }

      seen.add(langCode);
      result.push({
        value: langCode,
        label: format.audioTrack.displayName
      });
    }

    return result;
  });

  const audioPlayerLabel = $derived(selectedAudioFormat?.audioTrack?.displayName ?? null);

  const audioOriginalLabel = $derived(findOriginalAudioFormat(audioFormats)?.audioTrack?.displayName ?? null);

  const captionPlayerLabel = $derived(selectedCaptionTrack?.name.simpleText ?? null);

  const captionOriginalLabel = $derived.by(() => {
    const originalLangId = findOriginalAudioFormat(audioFormats)?.audioTrack?.id;
    if (originalLangId) {
      const langCode = normalizeLanguageCode(originalLangId);
      const match = captionTracks.find(track => normalizeLanguageCode(track.languageCode) === langCode && !track.kind)
        ?? captionTracks.find(track => normalizeLanguageCode(track.languageCode) === langCode);
      if (match) {
        return match.name.simpleText;
      }
    }

    return captionTracks.find(track => !track.kind)?.name.simpleText
      ?? captionTracks[0]?.name.simpleText
      ?? null;
  });

  const captionCustomOptions = $derived(
    captionTracks.map(track => ({
      value: track.vssId,
      label: track.name.simpleText
    }))
  );

  const qualityOptions = $derived.by(() => {
    if (isAudio) {
      const selectedTrackId = selectedAudioFormat?.audioTrack?.id ?? null;
      const formats = uniqueAudioLanguages.length > 0
        ? audioFormats.filter(format => (format.audioTrack?.id ?? null) === selectedTrackId)
        : audioFormats;
      return formats.map(format => ({
        value: `${format.itag}:${format.audioTrack?.id ?? ""}`,
        label: `${Math.floor(format.bitrate / 1000)} kbps (${formatAudioCodecLabel(format.mimeType)})`
      }));
    }

    return videoFormats.map(format => ({
      value: format.itag.toString(),
      label: formatVideoQualityLabel(format)
    }));
  });

  const qualityValue = $derived(
    isAudio
      ? `${selectedAudioFormat?.itag ?? ""}:${selectedAudioFormat?.audioTrack?.id ?? ""}`
      : (selectedVideoFormat?.itag.toString() ?? "")
  );

  function applyPolymerTheme(elTarget: Element) {
    const elInput = elTarget.querySelector("input");
    if (elInput) {
      elInput.dir = "auto";
    }
  }
</script>

<div class="ytdl-options-container">
  <!-- Media -->
  <div class="ytdl-section">
    <div class="ytdl-section-label">Media</div>
    <div class="ytdl-media-grid">
      <PolymerSelect
        id="type-select"
        disabled={isDownloading}
        label="Type"
        onchange={newValue => {
          const type = DOWNLOAD_TYPES.find(item => item.value === newValue);
          if (type) {
            ondownloadtypechange(type.value);
          }
        }}
        options={DOWNLOAD_TYPES}
        value={downloadType}
      />
      <PolymerSelect
        id="quality-select"
        disabled={isDownloading}
        label="Quality"
        onchange={valueString => {
          if (isAudio) {
            const colonIndex = valueString.indexOf(":");
            const itag = parseInt(valueString.slice(0, colonIndex), 10);
            const trackId = valueString.slice(colonIndex + 1) || undefined;
            const format = audioFormats.find(
              audioFormat => audioFormat.itag === itag && audioFormat.audioTrack?.id === trackId
            );
            if (format) {
              onaudioformatchange(format);
            }
          } else {
            const itag = parseInt(valueString, 10);
            const format = videoFormats.find(videoFormat => videoFormat.itag === itag);
            if (format) {
              onvideoformatchange(format);
            }
          }
        }}
        options={qualityOptions}
        value={qualityValue}
      />
    </div>
  </div>

  <!-- Tracks -->
  {#if uniqueAudioLanguages.length > 0 || captionTracks.length > 0}
    <div class="ytdl-section">
      <div class="ytdl-section-label">Tracks</div>
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
        <p class="ytdl-extras-note">Selected track is the default — all others are bundled as extras</p>
      {/if}
      <TrackChoice
        customOptions={captionCustomOptions}
        customValue={selectedCaptionTrack?.vssId ?? ""}
        disabled={isDownloading || captionTracks.length === 0}
        kind={TrackKind.Captions}
        mode={panelCaptionMode}
        oncustomchange={vssId => oncaptionchange(captionTracks.find(track => track.vssId === vssId) ?? null)}
        onmodechange={oncaptionmodechange}
        originalLabel={captionOriginalLabel}
        playerLabel={captionPlayerLabel}
      />
    </div>
  {/if}

  <!-- Output -->
  <div class="ytdl-section">
    <div class="ytdl-section-label">Output</div>
    <tp-yt-paper-input
      id="filename-input"
      {@attach applyPolymerTheme}
      aria-describedby={!isFilenameValid ? "filename-error" : undefined}
      aria-invalid={!isFilenameValid}
      autocomplete="off"
      disabled={isDownloading || undefined}
      error-message={filenameValidationError}
      invalid={!isFilenameValid || undefined}
      label="Filename"
      oninput={e => {
        if (!(e.target instanceof HTMLInputElement)) {
          return;
        }

        const value = e.target.value.trim();
        const { name, extension } = splitFilenameAndExtension(value);
        onfilenamechange(name);
        onextensionchange(extension);
      }}
      spellcheck={false}
      value={fullFilename}
    ></tp-yt-paper-input>
  </div>
</div>

<style>
  .ytdl-options-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding-bottom: 4px;
  }

  .ytdl-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .ytdl-section-label {
    padding-bottom: 4px;
    border-bottom: 1px solid var(--yt-spec-10-percent-layer, rgb(0 0 0 / 10%));
    color: var(--yt-spec-text-secondary, #606060);
    font-weight: 700;
    font-size: 1rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;

    :global(html[dark]) & {
      border-bottom-color: var(--yt-spec-10-percent-layer, rgb(255 255 255 / 10%));
      color: var(--yt-spec-text-secondary, #aaaaaa);
    }
  }

  .ytdl-extras-note {
    margin: 0;
    color: var(--yt-spec-text-secondary, #606060);
    font-size: 1.2rem;

    :global(html[dark]) & {
      color: var(--yt-spec-text-secondary, #aaaaaa);
    }
  }

  .ytdl-media-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  /* ShadyDOM blocks updateStyles/setProperty from the isolated world; CSS rule is the only fix. */
  :global(tp-yt-paper-input#filename-input label) {
    color: var(--yt-spec-text-secondary, #606060) !important;

    :global(html[dark]) & {
      color: var(--yt-spec-text-secondary, #aaaaaa) !important;
    }
  }

  :global(tp-yt-paper-input#filename-input[focused] label) {
    color: var(--yt-spec-call-to-action, #065fd4) !important;

    :global(html[dark]) & {
      color: var(--yt-spec-call-to-action, #3ea6ff) !important;
    }
  }
</style>

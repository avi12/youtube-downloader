<script lang="ts">
  import PolymerSelect from "../polymer-select/PolymerSelect.svelte";
  import { splitFilenameAndExtension, supportedExtensions } from "@/lib/utils/containers";
  import { formatAudioCodecLabel, formatVideoQualityLabel } from "@/lib/youtube/video-helpers";
  import { DownloadType, isPolymerInputElement } from "@/types";
  import type { AdaptiveFormatItem } from "@/types";

  interface Props {
    downloadType: DownloadType;
    videoFormats: AdaptiveFormatItem[];
    audioFormats: AdaptiveFormatItem[];
    selectedVideoFormat: AdaptiveFormatItem | null;
    selectedAudioFormat: AdaptiveFormatItem | null;
    filename: string;
    extension: string;
    isDownloading: boolean;
    ondownloadtypechange: (type: DownloadType) => void;
    onvideoformatchange: (format: AdaptiveFormatItem) => void;
    onaudioformatchange: (format: AdaptiveFormatItem) => void;
    onfilenamechange: (filename: string) => void;
    onextensionchange: (extension: string) => void;
    onvalidationchange: (isValid: boolean) => void;
  }

  const {
    downloadType,
    videoFormats,
    audioFormats,
    selectedVideoFormat,
    selectedAudioFormat,
    filename,
    extension,
    isDownloading,
    ondownloadtypechange,
    onvideoformatchange,
    onaudioformatchange,
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

  const hasMultipleAudioTracks = $derived(audioFormats.some(format => !!format.audioTrack));

  const qualityOptions = $derived.by(() => {
    if (isAudio) {
      return audioFormats.map(format => {
        const bitrateLabel = `${Math.floor(format.bitrate / 1000)} kbps (${formatAudioCodecLabel(format.mimeType)})`;
        return {
          value: `${format.itag}:${format.audioTrack?.id ?? ""}`,
          label: hasMultipleAudioTracks && format.audioTrack
            ? `${format.audioTrack.displayName} - ${bitrateLabel}`
            : bitrateLabel
        };
      });
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

    function applyLabelColor() {
      if (!isPolymerInputElement(elTarget)) {
        return;
      }

      const isDark = document.documentElement.hasAttribute("dark");
      elTarget.updateStyles({
        "--paper-input-container-color": isDark
          ? "var(--yt-spec-text-secondary, #aaaaaa)"
          : "var(--yt-spec-text-secondary, #606060)"
      });
    }

    // Apply immediately, then again after Polymer's own init rAF resets the value.
    applyLabelColor();
    requestAnimationFrame(applyLabelColor);

    const observer = new MutationObserver(applyLabelColor);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["dark"]
    });

    return () => observer.disconnect();
  }
</script>

<div class="ytdl-options-container">
  <!-- Type -->
  <div class="ytdl-options-field">
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
  </div>

  <!-- Quality -->
  <div class="ytdl-options-field">
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

  <!-- Filename -->
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

<style>
  .ytdl-options-container {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-bottom: 4px;
  }

  .ytdl-options-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
</style>

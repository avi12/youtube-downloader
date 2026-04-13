<script lang="ts">
  import PolymerSelect from "./PolymerSelect.svelte";
  import { splitFilenameAndExtension, supportedExtensions } from "@/lib/containers";
  import { applyPolymerCustomStyles, PAPER_INPUT_THEME } from "@/lib/polymer-utils";
  import { formatAudioCodecLabel, formatVideoQualityLabel } from "@/lib/video-helpers";
  import { DownloadType } from "@/types";
  import type { AdaptiveFormatItem } from "@/types";

  type Props = {
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
  };

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

  function getFilenameError(value: string, type: DownloadType.Video | DownloadType.Audio) {
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

  const filenameValidationError = $derived(getFilenameError(fullFilename, extensionType));
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

  const qualityOptions = $derived.by(() => {
    if (isAudio) {
      return audioFormats.map(format => ({
        value: format.itag.toString(),
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
      ? (selectedAudioFormat?.itag.toString() ?? "")
      : (selectedVideoFormat?.itag.toString() ?? "")
  );

  function applyPolymerTheme(elTarget: Element) {
    applyPolymerCustomStyles(elTarget, PAPER_INPUT_THEME);
    const elInput = elTarget.querySelector("input");
    if (elInput) {
      elInput.dir = "auto";
    }
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
      onchange={itagString => {
        const formats = isAudio ? audioFormats : videoFormats;
        const itag = parseInt(itagString, 10);
        const format = formats.find(format => format.itag === itag);
        if (!format) {
          return;
        }

        if (isAudio) {
          onaudioformatchange(format);
        } else {
          onvideoformatchange(format);
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

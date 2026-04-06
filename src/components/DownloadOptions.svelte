<script lang="ts">
  import { applyPolymerCustomStyles, PAPER_INPUT_THEME } from "../lib/polymer-utils";
  import { supportedExtensions } from "../lib/utils";
  import type { AdaptiveFormatItem, DownloadType } from "../types";
  import Select from "./Select.svelte";

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
    onextensionchange
  }: Props = $props();

  const extensionType = $derived(downloadType === "audio" ? "audio" : "video");
  const fullFilename = $derived(`${filename}.${extension}`);

  function getFilenameError(value: string, type: "video" | "audio") {
    const illegalMatch = value.match(/[<>:"/\\|?*]/);
    if (illegalMatch) {
      return `Character "${illegalMatch[0]}" isn't allowed in filenames`;
    }

    const iDot = value.indexOf(".");
    if (iDot === -1) {
      return "Filename needs a file extension";
    }

    const name = value.slice(0, value.lastIndexOf("."));
    if (!name.trim()) {
      return "Filename can't be empty";
    }

    const ext = value.slice(value.lastIndexOf(".") + 1).toLowerCase();
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

  function validateFilename(elInput: HTMLInputElement, value: string) {
    const errorMessage = getFilenameError(value, extensionType);
    elInput.setCustomValidity(errorMessage);
  }

  const DOWNLOAD_TYPES: { value: DownloadType;
    label: string; }[] = [
    {
      value: "video+audio",
      label: "Video + Audio"
    },
    {
      value: "video",
      label: "Video only"
    },
    {
      value: "audio",
      label: "Audio only"
    }
  ];

  const isAudio = $derived(downloadType === "audio");

  const qualityOptions = $derived(
    isAudio
      ? audioFormats.map(format => ({
        value: format.itag.toString(),
        label: `${Math.floor(format.bitrate / 1000)} kbps`
      }))
      : videoFormats.map(format => {
        const isPremium = format.qualityLabel?.includes("Premium") ?? false;
        const base = `${format.height}p${format.fps ? ` ${format.fps}fps` : ""}`;
        return {
          value: format.itag.toString(),
          label: isPremium ? `${base} (Enhanced)` : base
        };
      })
  );

  const qualityValue = $derived(
    isAudio
      ? (selectedAudioFormat?.itag.toString() ?? "")
      : (selectedVideoFormat?.itag.toString() ?? "")
  );

  function handleFilenameInput(e: Event) {
    if (!(e.target instanceof HTMLInputElement)) {
      return;
    }

    const value = e.target.value.trim();
    const iLastDot = value.lastIndexOf(".");
    if (iLastDot === -1) {
      onfilenamechange(value);
      onextensionchange("");
    } else {
      onfilenamechange(value.slice(0, iLastDot));
      onextensionchange(value.slice(iLastDot + 1));
    }

    validateFilename(e.target, value);
  }

  function applyPolymerTheme(element: Element) {
    applyPolymerCustomStyles(element, PAPER_INPUT_THEME);
  }

  function handleDownloadTypeSelect(newValue: string) {
    const type = DOWNLOAD_TYPES.find(item => item.value === newValue);
    if (type) {
      ondownloadtypechange(type.value);
    }
  }
</script>

<div class="ytdl-options-container">
  <!-- Type -->
  <div class="ytdl-options-field">
    <Select
      id="type-select"
      disabled={isDownloading}
      label="Type"
      onchange={handleDownloadTypeSelect}
      options={DOWNLOAD_TYPES}
      value={downloadType}
    />
  </div>

  <!-- Quality -->
  <div class="ytdl-options-field">
    <Select
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
    aria-invalid={!isFilenameValid || undefined}
    autocomplete="off"
    disabled={isDownloading || undefined}
    error-message={filenameValidationError || undefined}
    invalid={!isFilenameValid || undefined}
    label="Filename"
    oninput={handleFilenameInput}
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

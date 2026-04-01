<script lang="ts">
  import { supportedExtensions } from "../lib/utils";
  import type { AdaptiveFormatItem, DownloadType } from "../types";
  import Select from "./Select.svelte";
  import { z } from "zod";

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

  const filenameValidationError = $derived.by(() => {
    const schema = createFilenameSchema(extensionType);
    const result = schema.safeParse(fullFilename);
    if (result.success) {
      return "";
    }

    return result.error.issues[0].message;
  });
  const isFilenameValid = $derived(!filenameValidationError);

  function createFilenameSchema(type: "video" | "audio") {
    const validExtensions = supportedExtensions[type];
    return z.string().superRefine((value, context) => {
      const dotIndex = value.indexOf(".");
      if (dotIndex === -1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Filename needs a file extension"
        });
        return;
      }

      const name = value.slice(0, value.lastIndexOf("."));
      if (!name.trim()) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Filename can't be empty"
        });
        return;
      }

      const ext = value.slice(value.lastIndexOf(".") + 1).toLowerCase();
      if (!validExtensions.includes(ext)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Extension .${ext} isn't supported for ${type} - try ${validExtensions.join(", ")}`
        });
      }
    });
  }

  function validateFilename(elInput: HTMLInputElement, value: string) {
    const schema = createFilenameSchema(extensionType);
    const result = schema.safeParse(value);
    const errorMessage = result.success ? "" : result.error.issues[0].message;
    elInput.setCustomValidity(errorMessage);
    elInput.reportValidity();
  }

  const DOWNLOAD_TYPES: { value: DownloadType; label: string }[] = [
    { value: "video+audio", label: "Video + Audio" },
    { value: "video", label: "Video only" },
    { value: "audio", label: "Audio only" }
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
        return { value: format.itag.toString(), label: isPremium ? `${base} (Enhanced)` : base };
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

    const value = e.target.value;
    const parts = value.trim().split(".");
    const newExtension = parts.pop() ?? "";
    const newFilename = parts.join(".");
    if (newFilename) {
      onfilenamechange(newFilename);
    }

    if (newExtension) {
      onextensionchange(newExtension);
    }

    validateFilename(e.target, value.trim());
  }

  function handleDownloadTypeSelect(newValue: string) {
    const type = DOWNLOAD_TYPES.find(item => item.value === newValue);
    if (type) {
      ondownloadtypechange(type.value);
    }
  }
</script>

<div class="options">
  <!-- Type -->
  <div class="field">
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
  <div class="field">
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
  <div class="field">
    <label class="field-label" for="filename-input">Filename</label>
    <div class="field-bar" class:field-bar--error={!isFilenameValid}>
      <input
        id="filename-input"
        class="field-input"
        aria-describedby={!isFilenameValid ? "filename-error" : undefined}
        aria-invalid={!isFilenameValid}
        autocomplete="off"
        disabled={isDownloading}
        oninput={handleFilenameInput}
        type="text"
        value={fullFilename}
      />
    </div>
  </div>

  <!-- Filename validation error -->
  {#if !isFilenameValid}
    <p id="filename-error" class="extension-error" aria-live="polite" role="alert">
      {filenameValidationError}
    </p>
  {/if}
</div>

<style>
  .options {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-bottom: 4px;
    color: var(--yt-spec-text-primary, rgb(15 15 15));
    font-family: Roboto, Noto, sans-serif;
    font-size: 1.4rem;
  }

  /* -- Fields --------------------------------------------------------------- */

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field-label {
    color: var(--yt-spec-text-secondary, rgb(96 96 96));
    font-size: 1.3rem;
    line-height: 1;
  }

  .field-bar {
    display: flex;
    align-items: center;
    height: 48px;
    padding: 0 16px;
    border: 1px solid color-mix(in sRGB, var(--yt-spec-text-primary, rgb(15 15 15)) 12%, transparent);
    border-radius: 12px;
    background: var(--yt-spec-menu-background, rgb(242 242 242));
    transition: border-color 100ms;
  }

  .field-bar:focus-within {
    border-color: var(--yt-spec-text-primary, rgb(15 15 15));
  }

  .field-bar--error {
    border-color: rgb(204 0 0);
  }

  .field-input {
    flex: 1;
    align-self: stretch;
    min-width: 0;
    border: none;
    background: transparent;
    color: var(--yt-spec-text-primary, rgb(15 15 15));
    outline-style: none;
    font-family: inherit;
    font-size: 1.4rem;
  }

  /* -- Extension error ------------------------------------------------------ */

  .extension-error {
    margin-top: -6px;
    color: rgb(204 0 0);
    font-size: 1.2rem;
    line-height: 1.4;
  }
</style>

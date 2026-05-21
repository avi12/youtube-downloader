<script lang="ts">
  import PolymerSelect from "../polymer-select/PolymerSelect.svelte";
  import { buildFormatItems, getFilenameError } from "./download-options-helpers";
  import { getFormatDescription } from "@/lib/utils/containers";
  import { DownloadType } from "@/types";

  interface Props {
    filename: string;
    extension: string;
    actualExtension: string;
    isDownloading: boolean;
    downloadType: DownloadType;
    isMultiTrack: boolean;
    onfilenamechange: (filename: string) => void;
    onextensionchange: (extension: string) => void;
    onvalidationchange: (isValid: boolean) => void;
  }

  const {
    filename, extension, actualExtension, isDownloading, downloadType, isMultiTrack,
    onfilenamechange, onextensionchange, onvalidationchange
  }: Props = $props();

  const isAudio = $derived(downloadType === DownloadType.Audio);
  const extensionType = $derived(isAudio ? DownloadType.Audio : DownloadType.Video);

  const filenameValidationError = $derived(
    getFilenameError({
      value: `${filename}.${extension}`,
      type: extensionType,
      isMultiTrack
    })
  );
  const isFilenameValid = $derived(!filenameValidationError);
  const formatOptions = $derived(
    buildFormatItems(extensionType, isMultiTrack).map(item => ({
      value: item.ext,
      label: `.${item.ext}`,
      disabled: item.isExcluded
    }))
  );

  const currentFormatDesc = $derived(getFormatDescription(extension));

  $effect(() => {
    onvalidationchange(isFilenameValid);
  });

  function applyPolymerTheme(elTarget: Element): void {
    const elInput = elTarget.querySelector("input");
    if (elInput) {
      elInput.dir = "auto";
    }
  }

  function handleInput(e: Event): void {
    const isInputElement = e.target instanceof HTMLInputElement;
    if (!isInputElement) {
      return;
    }

    onfilenamechange(e.target.value.trim());
  }
</script>

<div class="ytdl-section">
  <div class="ytdl-output-row">
    <tp-yt-paper-input
      id="filename-input"
      {@attach applyPolymerTheme}
      aria-invalid={!isFilenameValid}
      autocomplete="off"
      disabled={isDownloading || undefined}
      invalid={!isFilenameValid || undefined}
      label="Filename"
      oninput={handleInput}
      spellcheck={false}
      value={filename}
    ></tp-yt-paper-input>
    <div class="ytdl-format-select">
      <PolymerSelect
        id="format-select"
        disabled={isDownloading}
        label="Format"
        onchange={onextensionchange}
        options={formatOptions}
        value={extension}
      />
    </div>
  </div>
  {#if currentFormatDesc}
    <p class="ytdl-format-hint">{currentFormatDesc}</p>
  {/if}
  {#if extension !== actualExtension && !isFilenameValid}
    <p class="ytdl-extension-note">Will be saved as .{actualExtension} due to format constraints</p>
  {/if}
</div>

<style>
  .ytdl-output-row {
    display: flex;
    gap: 8px;
    align-items: flex-end;
  }

  tp-yt-paper-input {
    flex: 1;
    min-width: 0;
  }

  .ytdl-format-select {
    flex-shrink: 0;

    :global(.ytdl-select-label) {
      display: none;
    }

    :global(.ytdl-select-trigger) {
      width: auto;
      min-width: 90px;
    }
  }

  :global {
    #filename-input {
      label {
        color: var(--yt-sys-color-baseline--text-secondary, #606060) !important;
      }

      &[focused] label {
        color: var(--yt-sys-color-baseline--call-to-action, #065fd4) !important;
      }

      tp-yt-paper-input-container {
        padding-bottom: 0;
      }

      &[invalid] tp-yt-paper-input-container {
        border-inline-start: none;
        box-shadow: none;
      }
    }
  }

  .ytdl-format-hint {
    margin: 0;
    color: var(--yt-sys-color-baseline--text-secondary, #606060);
    font-size: 1.2rem;
  }

  .ytdl-extension-note {
    margin: 0;
    color: var(--yt-sys-color-baseline--text-secondary, #606060);
    font-size: 1.2rem;
  }
</style>

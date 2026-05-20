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
  const isExtensionError = $derived(
    filenameValidationError.startsWith("No extension") ||
    filenameValidationError.startsWith("Extension .") ||
    filenameValidationError.startsWith("AVI doesn't")
  );

  const formatOptions = $derived(
    buildFormatItems(extensionType, isMultiTrack).map(item => ({
      value: item.ext,
      label: item.isExcluded ? `.${item.ext} ⚠` : `.${item.ext}`
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
    if (!(e.target instanceof HTMLInputElement)) {
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
      aria-describedby={!isFilenameValid ? "filename-error" : undefined}
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
  <div
    id="filename-error"
    class="ytdl-filename-error-block"
    class:ytdl-open={!isFilenameValid}
  >
    <div class="ytdl-filename-error-inner">
      <p class="ytdl-filename-error-text">{filenameValidationError}</p>
      <div class="ytdl-format-list-block" class:ytdl-open={isExtensionError}>
        <ul class="ytdl-format-list" role="list">
          {#each buildFormatItems(extensionType, isMultiTrack) as { ext, desc, isExcluded } (ext)}
            <li class="ytdl-format-item" class:ytdl-excluded={isExcluded}>
              <div class="ytdl-format-item-inner">
                <span class="ytdl-format-ext">{ext}</span>
                <span class="ytdl-format-desc">{desc}</span>
              </div>
            </li>
          {/each}
        </ul>
      </div>
    </div>
  </div>
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

  .ytdl-filename-error-block {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 250ms ease;

    &.ytdl-open {
      grid-template-rows: 1fr;
    }

    .ytdl-filename-error-inner {
      overflow: hidden;
      min-height: 0;

      .ytdl-filename-error-text {
        color: var(--paper-input-container-invalid-color, var(--error-color, #cc0000));
        font-size: 1.2rem;
      }

      .ytdl-format-list-block {
        display: grid;
        grid-template-rows: 0fr;
        transition: grid-template-rows 250ms ease;

        &.ytdl-open {
          grid-template-rows: 1fr;
        }

        .ytdl-format-list {
          display: flex;
          flex-direction: column;
          overflow: hidden;
          min-height: 0;
          padding: 0;
          color: var(--paper-input-container-invalid-color, var(--error-color, #cc0000));
          list-style: none;
          font-size: 1.2rem;

          .ytdl-format-item {
            @starting-style {
              grid-template-rows: 0fr;
            }

            display: grid;
            grid-template-rows: 1fr;
            transition: grid-template-rows 250ms ease;

            &:global(.ytdl-excluded) {
              grid-template-rows: 0fr;
            }

            & + .ytdl-format-item {
              margin-top: 4px;
            }

            .ytdl-format-item-inner {
              display: grid;
              grid-template-columns: auto 1fr;
              overflow: hidden;
              min-height: 0;
              column-gap: 8px;
            }

            .ytdl-format-ext {
              font-weight: 600;
            }
          }
        }
      }
    }
  }
</style>

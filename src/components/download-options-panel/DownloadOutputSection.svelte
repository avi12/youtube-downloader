<script lang="ts">
  import { getFilenameError, buildFormatItems } from "./download-options-helpers";
  import { splitFilenameAndExtension } from "@/lib/utils/containers";
  import { DownloadType } from "@/types";

  interface Props {
    filename: string;
    extension: string;
    isDownloading: boolean;
    downloadType: DownloadType;
    isMultiTrack: boolean;
    onfilenamechange: (filename: string) => void;
    onextensionchange: (extension: string) => void;
    onvalidationchange: (isValid: boolean) => void;
  }

  const {
    filename, extension, isDownloading, downloadType, isMultiTrack,
    onfilenamechange, onextensionchange, onvalidationchange
  }: Props = $props();

  const isAudio = $derived(downloadType === DownloadType.Audio);
  const extensionType = $derived(isAudio ? DownloadType.Audio : DownloadType.Video);
  const fullFilename = $derived(`${filename}.${extension}`);
  const filenameValidationError = $derived(
    getFilenameError({
      value: fullFilename,
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
  const formatItems = $derived(buildFormatItems(extensionType, isMultiTrack));

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

    const value = e.target.value.trim();
    const { name, extension: ext } = splitFilenameAndExtension(value);
    onfilenamechange(name);
    onextensionchange(ext);
  }
</script>

<div class="ytdl-section">
  <span class="ytdl-section-label">Output</span>
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
    value={fullFilename}
  ></tp-yt-paper-input>
  <div
    id="filename-error"
    class="ytdl-filename-error-block"
    class:ytdl-open={!isFilenameValid}
  >
    <div class="ytdl-filename-error-inner">
      <p class="ytdl-filename-error-text">{filenameValidationError}</p>
      <div class="ytdl-format-list-block" class:ytdl-open={isExtensionError}>
        <ul class="ytdl-format-list" role="list">
          {#each formatItems as { ext, desc } (ext)}
            <li class="ytdl-format-item">
              <span class="ytdl-format-ext">{ext}</span>
              <span class="ytdl-format-desc">{desc}</span>
            </li>
          {/each}
        </ul>
      </div>
    </div>
  </div>
</div>

<style>
  /* ShadyDOM blocks updateStyles/setProperty from the isolated world; CSS rule is the only fix. */
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
    }
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
          display: grid;
          grid-template-columns: auto 1fr;
          row-gap: 4px;
          overflow: hidden;
          min-height: 0;
          padding: 0;
          color: var(--paper-input-container-invalid-color, var(--error-color, #cc0000));
          list-style: none;
          font-size: 1.2rem;
          column-gap: 8px;

          .ytdl-format-item {
            display: contents;

            .ytdl-format-ext {
              font-weight: 600;
            }
          }
        }
      }
    }
  }
</style>

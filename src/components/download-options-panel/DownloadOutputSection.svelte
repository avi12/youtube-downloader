<script lang="ts">
  import { getFilenameError } from "./download-options-helpers";
  import { splitFilenameAndExtension } from "@/lib/utils/containers";
  import { DownloadType } from "@/types";

  interface Props {
    filename: string;
    extension: string;
    isDownloading: boolean;
    downloadType: DownloadType;
    onfilenamechange: (filename: string) => void;
    onextensionchange: (extension: string) => void;
    onvalidationchange: (isValid: boolean) => void;
  }

  const {
    filename, extension, isDownloading, downloadType,
    onfilenamechange, onextensionchange, onvalidationchange
  }: Props = $props();

  const isAudio = $derived(downloadType === DownloadType.Audio);
  const extensionType = $derived(isAudio ? DownloadType.Audio : DownloadType.Video);
  const fullFilename = $derived(`${filename}.${extension}`);
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
    error-message={filenameValidationError}
    invalid={!isFilenameValid || undefined}
    label="Filename"
    oninput={handleInput}
    spellcheck={false}
    value={fullFilename}
  ></tp-yt-paper-input>
</div>

<style>
  /* ShadyDOM blocks updateStyles/setProperty from the isolated world; CSS rule is the only fix. */
  :global(tp-yt-paper-input#filename-input label) {
    color: var(--yt-sys-color-baseline--text-secondary, #606060) !important;
  }

  :global(tp-yt-paper-input#filename-input[focused] label) {
    color: var(--yt-sys-color-baseline--call-to-action, #065fd4) !important;
  }
</style>

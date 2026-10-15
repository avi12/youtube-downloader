<script lang="ts">
  import PolymerSelect from "../polymer-select/PolymerSelect.svelte";
  import OptionHint from "./OptionHint.svelte";
  import { createOutputSelectState, type OutputSelectProps } from "@/lib/download-options/output-select.svelte.ts";
  import { getCompatibleFilename } from "@/lib/utils/containers";

  interface Props extends OutputSelectProps {
    isDownloading: boolean;
    onfilenamechange: (filename: string) => void;
    onextensionchange: (extension: string) => void;
    onvalidationchange: (isValid: boolean) => void;
  }

  const props: Props = $props();

  const output = createOutputSelectState(() => props);

  $effect(() => {
    props.onvalidationchange(output.isFilenameValid);
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

    props.onfilenamechange(getCompatibleFilename(e.target.value.trim()));
  }
</script>

<div class="ytdl-section">
  <div class="ytdl-output-row">
    <tp-yt-paper-input
      id="filename-input"
      {@attach applyPolymerTheme}
      aria-invalid={!output.isFilenameValid}
      autocomplete="off"
      disabled={props.isDownloading || undefined}
      invalid={!output.isFilenameValid || undefined}
      label="Filename"
      oninput={handleInput}
      spellcheck={false}
      value={props.filename}
    ></tp-yt-paper-input>
    <div class="ytdl-format-select">
      <PolymerSelect
        id="format-select"
        disabled={props.isDownloading}
        label="Format"
        onchange={props.onextensionchange}
        options={output.formatOptions}
        value={props.extension}
      />
    </div>
  </div>
  {#if output.formatDescription}
    <OptionHint text={output.formatDescription} />
  {/if}
  {#if output.isConstraintHintShown}
    <OptionHint text={`Will be saved as .${props.actualExtension} due to format constraints`} />
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
</style>

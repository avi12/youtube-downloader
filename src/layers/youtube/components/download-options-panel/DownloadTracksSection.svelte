<script lang="ts">
  import PolymerSelect from "../polymer-select/PolymerSelect.svelte";
  import { createTrackSelectState, type TrackSelectProps } from "@/lib/download-options/track-select.svelte.ts";
  import { onButtonClick } from "@/lib/messaging/cross-world-messenger";
  import {
    attachTracksHeaderButton as attachTracksHeaderButtonUtil
  } from "#youtube/lib/ui/panel-button-attachments.svelte";

  interface Props extends TrackSelectProps {
    isDownloading: boolean;
    downloadExtras: boolean;
    downloadExtraCaptions: boolean;
    isExtrasAutoDisabled: boolean;
    ondownloadextraschange: (value: boolean) => void;
    ondownloadextracaptionschange: (value: boolean) => void;
  }

  const props: Props = $props();

  const TRACKS_HEADER_BUTTON_ID = "ytdl-tracks-header-btn";
  const scopingClass = document.querySelector("[data-ytdl-download-group] yt-button-view-model, yt-button-view-model")?.getAttribute("class") ?? "";

  const tracks = createTrackSelectState(() => props);

  let isOpen = $state(false);

  $effect(() => onButtonClick(buttonId => {
    if (buttonId === TRACKS_HEADER_BUTTON_ID) {
      isOpen = !isOpen;
    }
  }));

  function attachTracksHeaderButton(elButton: Element): void {
    attachTracksHeaderButtonUtil({
      elButton,
      getIsOpen: () => isOpen,
      getIsDownloading: () => props.isDownloading,
      getIsAudioOnly: () => tracks.isAudioOnly,
      getSummaryMeta: () => tracks.summaryMeta
    });
  }
</script>

<div class="ytdl-tracks-section-host" class:is-open={tracks.isVisible}>
  <div class="ytdl-tracks-wrapper">
    <yt-button-view-model
      class={scopingClass}
      {@attach attachTracksHeaderButton}
      aria-expanded={isOpen}
      data-ytdl-button-id={TRACKS_HEADER_BUTTON_ID}
      role="button"
      tabindex={props.isDownloading ? undefined : 0}
    ></yt-button-view-model>

    <div class="ytdl-tracks-body" class:is-open={isOpen}>
      <div class="ytdl-tracks-body-inner">
        {#if tracks.isAudioTrackSelectorPresent}
          <div class="ytdl-track-field">
            <PolymerSelect
              id="tracks-audio-select"
              disabled={props.isDownloading}
              label="Audio language"
              onchange={tracks.handleAudioChange}
              options={tracks.audioOptions}
              value={tracks.audioSelectValue}
            />
            {#if tracks.isExtrasToggleShown}
              <tp-yt-paper-toggle-button
                aria-label="Include all audio tracks"
                checked={props.downloadExtras ? "" : undefined}
                disabled={props.isDownloading || tracks.isExtensionMultiTrackIncompatible ? "" : undefined}
                onchange={e => {
                  const isHtmlElement = e.target instanceof HTMLElement;
                  if (isHtmlElement) {
                    props.ondownloadextraschange(e.target.hasAttribute("checked"));
                  }
                }}
              >Include all audio tracks</tp-yt-paper-toggle-button>
              <div class="ytdl-extras-error-host" class:is-open={props.isExtrasAutoDisabled}>
                <p class="ytdl-extras-error">AVI doesn't support multiple audio tracks</p>
              </div>
            {/if}
          </div>
        {/if}

        {#if tracks.isCaptionSelectorPresent}
          <div class="ytdl-track-field">
            <PolymerSelect
              id="tracks-caption-select"
              disabled={props.isDownloading}
              label="Captions"
              onchange={tracks.handleCaptionChange}
              options={tracks.captionOptions}
              value={tracks.captionSelectValue}
            />
            {#if tracks.isExtraCaptionsToggleShown}
              <tp-yt-paper-toggle-button
                aria-label="Include all captions"
                checked={props.downloadExtraCaptions ? "" : undefined}
                disabled={props.isDownloading ? "" : undefined}
                onchange={e => {
                  const isHtmlElement = e.target instanceof HTMLElement;
                  if (isHtmlElement) {
                    props.ondownloadextracaptionschange(e.target.hasAttribute("checked"));
                  }
                }}
              >Include all captions</tp-yt-paper-toggle-button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .ytdl-tracks-section-host {
    display: grid;
    grid-template-rows: minmax(0, 0fr);
    overflow: hidden;
    transition: grid-template-rows 300ms cubic-bezier(0.33, 1, 0.68, 1);

    &.is-open {
      grid-template-rows: minmax(0, 1fr);
    }
  }

  .ytdl-tracks-wrapper {
    overflow: hidden;
    min-height: 0;
    padding-top: 16px;
  }

  .ytdl-tracks-body {
    display: grid;
    grid-template-rows: minmax(0, 0fr);
    overflow: hidden;
    transition: grid-template-rows 220ms ease;

    &.is-open {
      grid-template-rows: minmax(0, 1fr);
      border: 1px solid var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 10%));
      border-top: none;
      border-bottom-right-radius: 10px;
      border-bottom-left-radius: 10px;
    }
  }

  .ytdl-tracks-body-inner {
    display: flex;
    flex-direction: column;
    gap: 24px;
    overflow: hidden;
    min-height: 0;
    padding: 14px;
  }

  .ytdl-track-field {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  :global(tp-yt-paper-toggle-button) {
    color: var(--yt-sys-color-baseline--text-primary, #0f0f0f);
    font-size: 1.3rem;
  }

  .ytdl-extras-error-host {
    display: grid;
    grid-template-rows: minmax(0, 0fr);
    overflow: hidden;
    transition: grid-template-rows 220ms ease;

    &.is-open {
      grid-template-rows: minmax(0, 1fr);
    }
  }

  .ytdl-extras-error {
    margin: 0;
    padding-top: 4px;
    color: var(--yt-sys-color-baseline--text-error, #d93025);
    font-size: 1.2rem;
  }
</style>

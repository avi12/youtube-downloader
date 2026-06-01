<script lang="ts">
  import AiCaptions from "../icons/AiCaptions.svelte";
  import AudioVolume from "../icons/AudioVolume.svelte";
  import Captions from "../icons/Captions.svelte";
  import AudioTrackSection from "./AudioTrackSection.svelte";
  import CaptionLanguageSection from "./CaptionLanguageSection.svelte";
  import type { SlidingSettingsProps } from "./settings-types";
  import SettingsGroup from "./SettingsGroup.svelte";
  import { setOption } from "@/lib/storage/storage";

  const { options, slideDuration }: SlidingSettingsProps = $props();
</script>

<SettingsGroup title="Audio &amp; subtitles">
  <label class="set-item set-item-label">
    <div class="set-lead accent">
      <Captions size={20} />
    </div>
    <div class="set-txt">
      <span class="set-label">Download additional audio tracks and captions</span>
    </div>
    <div class="set-trail">
      <span class="set-switch">
        <input
          class="set-switch-input"
          checked={options.downloadExtras}
          onchange={e => {
            if (!(e.target instanceof HTMLInputElement)) {
              return;
            }

            void setOption({
              key: "downloadExtras",
              value: e.target.checked
            });
          }}
          role="switch"
          type="checkbox"
        />
        <span class="set-switch-track"></span>
      </span>
    </div>
  </label>
  <label class="set-item set-item-label">
    <div class="set-lead">
      <AudioVolume size={20} />
    </div>
    <div class="set-txt">
      <span class="set-label">Include auto-dubbed audio tracks</span>
    </div>
    <div class="set-trail">
      <span class="set-switch">
        <input
          class="set-switch-input"
          checked={options.includeAutoDubbing}
          onchange={e => {
            if (!(e.target instanceof HTMLInputElement)) {
              return;
            }

            void setOption({
              key: "includeAutoDubbing",
              value: e.target.checked
            });
          }}
          role="switch"
          type="checkbox"
        />
        <span class="set-switch-track"></span>
      </span>
    </div>
  </label>
  <label class="set-item set-item-label">
    <div class="set-lead">
      <AiCaptions size={20} />
    </div>
    <div class="set-txt">
      <span class="set-label">Include AI-generated captions</span>
    </div>
    <div class="set-trail">
      <span class="set-switch">
        <input
          class="set-switch-input"
          checked={options.includeAiCaptions}
          onchange={e => {
            if (!(e.target instanceof HTMLInputElement)) {
              return;
            }

            void setOption({
              key: "includeAiCaptions",
              value: e.target.checked
            });
          }}
          role="switch"
          type="checkbox"
        />
        <span class="set-switch-track"></span>
      </span>
    </div>
  </label>
  <AudioTrackSection {options} {slideDuration} />
  <CaptionLanguageSection {options} />
</SettingsGroup>

<style>
  .set-item {
    display: flex;
    gap: 13px;
    align-items: center;
    min-height: 52px;
    padding: 13px 14px;
  }

  .set-item-label {
    cursor: pointer;
  }

  .set-lead {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: var(--surface-high);
    color: var(--fg-muted);

    &.accent {
      background: var(--accent-container);
      color: var(--fg);
    }
  }

  .set-txt {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .set-label {
    color: var(--fg);
    font-weight: 500;
    font-size: 0.84375rem;
  }

  .set-trail {
    display: flex;
    flex-shrink: 0;
    gap: 8px;
    align-items: center;
    color: var(--fg-muted);
  }

  .set-switch {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
  }

  .set-switch-track {
    position: relative;
    display: block;
    width: 52px;
    height: 32px;
    border-radius: 16px;
    background-color: var(--surface-high);
    box-shadow: inset 0 0 0 2px var(--fg-subtle);
    cursor: pointer;
    transition: background-color 250ms, box-shadow 250ms;

    &::after {
      content: "";
      position: absolute;
      top: 50%;
      left: 16px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background-color: var(--fg-subtle);
      transition: transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1), background-color 200ms;
      transform: translate(-50%, -50%);
    }
  }

  .set-switch-input {
    position: absolute;
    width: 0;
    height: 0;
    opacity: 0%;

    &:checked + .set-switch-track {
      background-color: var(--accent);
      box-shadow: inset 0 0 0 2px var(--accent);
    }

    &:checked + .set-switch-track::after {
      background-color: var(--on-primary);
      transform: translate(-50%, -50%) translateX(22px) scale(1.5);
    }

    &:focus-visible + .set-switch-track {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
  }
</style>

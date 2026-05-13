<script lang="ts">
  import PolymerSelect from "../polymer-select/PolymerSelect.svelte";
  import { onButtonClick } from "@/lib/messaging/cross-world-messenger";
  import { attachFmtStr, sendButtonData } from "@/lib/ui/polymer-utils";
  import {
    ButtonSize,
    ButtonState,
    ButtonStyle,
    ButtonType,
    IconName,
    PanelTrackMode,
    TrackKind,
    YtIconName
  } from "@/types";
  import { untrack } from "svelte";
  import { SvelteMap } from "svelte/reactivity";

  interface Props {
    kind: TrackKind;
    playerLabel: string | null;
    originalLabel: string | null;
    customOptions: {
      value: string;
      label: string;
    }[];
    customValue: string;
    mode: PanelTrackMode;
    disabled?: boolean;
    onmodechange: (mode: PanelTrackMode) => void;
    oncustomchange: (value: string) => void;
  }

  const {
    kind,
    playerLabel,
    originalLabel,
    customOptions,
    customValue,
    mode,
    disabled = false,
    onmodechange,
    oncustomchange
  }: Props = $props();

  const kindLabel = $derived(kind === TrackKind.Audio ? "Audio language" : "Captions");
  const originalSubLabel = $derived(
    kind === TrackKind.Audio ? "The creator's baked-in audio track" : "The video's original caption track"
  );
  const accessibleLabel = $derived(kind === TrackKind.Audio ? "Audio language" : "Caption language");

  const buttons = $derived([
    {
      id: `track-match-video-${kind}`,
      label: "Match video",
      mode: PanelTrackMode.MatchVideo
    },
    {
      id: `track-original-${kind}`,
      label: "Original",
      mode: PanelTrackMode.Original
    },
    {
      id: `track-custom-${kind}`,
      label: "Custom",
      mode: PanelTrackMode.Custom
    }
  ]);

  const elements = new SvelteMap<string, HTMLElement>();

  function refresh(button: (typeof buttons)[number]) {
    const elButton = elements.get(button.id);
    if (!elButton) {
      return;
    }

    const isSelected = mode === button.mode;
    sendButtonData({
      elButton,
      data: {
        iconName: IconName.None,
        title: button.label,
        accessibilityText: button.label,
        style: ButtonStyle.Mono,
        type: isSelected ? ButtonType.Filled : ButtonType.Text,
        buttonSize: ButtonSize.XSmall,
        state: disabled ? ButtonState.Disabled : ButtonState.Active,
        isFullWidth: false,
        isDisabled: disabled,
        tooltip: ""
      },
      a11y: {
        tabIndex: isSelected ? 0 : -1,
        role: "radio",
        ariaChecked: String(isSelected)
      }
    });
  }

  function refreshAll() {
    for (const button of buttons) {
      refresh(button);
    }
  }

  function createAttacher(button: (typeof buttons)[number]) {
    return (elTarget: Element) => {
      if (!(elTarget instanceof HTMLElement)) {
        return;
      }

      elements.set(button.id, elTarget);
      refresh(button);
    };
  }

  $effect.pre(() => {
    void mode;
    void disabled;
    refreshAll();
  });

  $effect(() => onButtonClick(buttonId => {
    untrack(() => {
      const match = buttons.find(button => button.id === buttonId);
      if (match) {
        onmodechange(match.mode);
      }
    });
  }));

  function handleSegKeydown(e: KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") {
      return;
    }

    e.preventDefault();
    const currentIndex = buttons.findIndex(btn => btn.mode === mode);
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (currentIndex + delta + buttons.length) % buttons.length;
    const nextButton = buttons[nextIndex];
    onmodechange(nextButton.mode);
    const elNext = elements.get(nextButton.id);
    queueMicrotask(() => elNext?.querySelector("button")?.focus());
  }
</script>

<div class="track-choice" class:is-disabled={disabled}>
  <div class="track-choice-head">
    <yt-formatted-string class="track-label" {@attach attachFmtStr} data-ytdl-text={kindLabel}></yt-formatted-string>
    <div class="track-seg" aria-label="{kindLabel} source" onkeydown={handleSegKeydown} role="radiogroup" tabindex="-1">
      {#each buttons as button (button.id)}
        <yt-button-view-model
          {@attach createAttacher(button)}
          data-ytdl-button-id={button.id}
        ></yt-button-view-model>
      {/each}
    </div>
  </div>

  {#if mode === PanelTrackMode.MatchVideo}
    <div class="track-follow">
      <div class="track-follow-icon" aria-hidden="true">
        <span class="sync-pulse"></span>
        <yt-icon class="sync-icon" icon={YtIconName.Autorenew}></yt-icon>
      </div>
      <div class="track-follow-body">
        <yt-formatted-string class="track-follow-value" {@attach attachFmtStr} data-ytdl-text={playerLabel ?? "—"}
        ></yt-formatted-string>
        <yt-formatted-string
          class="track-follow-sub"
          {@attach attachFmtStr}
          data-ytdl-text="Synced with player · changes as you switch tracks"
        ></yt-formatted-string>
      </div>
    </div>
  {:else if mode === PanelTrackMode.Original}
    <div class="track-follow track-original">
      <div class="track-original-badge" aria-hidden="true">ORIG</div>
      <div class="track-follow-body">
        <yt-formatted-string class="track-follow-value" {@attach attachFmtStr} data-ytdl-text={originalLabel ?? "Original"}
        ></yt-formatted-string>
        <yt-formatted-string class="track-follow-sub" {@attach attachFmtStr} data-ytdl-text={originalSubLabel}
        ></yt-formatted-string>
      </div>
    </div>
  {:else}
    <PolymerSelect
      id="track-custom-{kind}"
      {disabled}
      label={accessibleLabel}
      onchange={oncustomchange}
      options={customOptions}
      value={customValue}
    />
  {/if}
</div>

<style>
  .track-choice {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 10%));
    border-radius: 10px;
    background: var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 4%));

    &.is-disabled {
      opacity: 50%;
      pointer-events: none;
    }

    :global(.ytdl-select-label) {
      display: none;
    }
  }

  .track-choice-head {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    justify-content: space-between;
    align-items: center;
  }

  .track-label {
    color: var(--yt-sys-color-baseline--text-secondary, #606060);
    font-weight: 500;
    font-size: 1.4rem;
    white-space: nowrap;
  }

  .track-seg {
    display: inline-flex;
    flex-shrink: 0;
    gap: 2px;
    align-items: center;
    padding: 2px;
    border: 1px solid var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 10%));
    border-radius: 999px;
    background: var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 8%));
  }

  .track-follow {
    --ytdl-tficon-bg: color-mix(in oklch, var(--yt-sys-color-baseline--call-to-action, #065fd4) 18%, transparent);
    --ytdl-tficon-color: var(--yt-sys-color-baseline--call-to-action, #065fd4);

    display: flex;
    gap: 10px;
    align-items: center;
    padding: 8px 10px;
    border: 1px solid color-mix(in oklch, var(--yt-sys-color-baseline--call-to-action, #065fd4) 22%, transparent);
    border-radius: 8px;
    background: color-mix(in oklch, var(--yt-sys-color-baseline--call-to-action, #065fd4) 8%, transparent);
  }

  .track-follow-icon {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
    justify-content: center;
    align-items: center;
    width: 22px;
    height: 22px;
    border-radius: 999px;
    background: var(--ytdl-tficon-bg);
    color: var(--ytdl-tficon-color);
  }

  .sync-icon {
    width: 14px;
    height: 14px;
  }

  .sync-pulse {
    position: absolute;
    inset: 0;
    border: 1.5px solid var(--yt-sys-color-baseline--call-to-action, #065fd4);
    border-radius: 999px;
    opacity: 60%;
    animation: ytdl-track-pulse 2000ms ease-out infinite;
  }

  @keyframes ytdl-track-pulse {
    0% {
      opacity: 55%;
      transform: scale(0.85);
    }

    70% {
      opacity: 0%;
      transform: scale(1.35);
    }

    100% {
      opacity: 0%;
      transform: scale(1.35);
    }
  }

  .track-follow-body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .track-follow-value {
    display: block;
    overflow: hidden;
    color: var(--yt-sys-color-baseline--text-primary, #0f0f0f);
    font-weight: 600;
    font-size: 1.3rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .track-follow-sub {
    display: block;
    color: var(--yt-sys-color-baseline--text-secondary, #606060);
    font-size: 1.1rem;
  }

  .track-original {
    --ytdl-tficon-bg: var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 8%));
    --ytdl-tficon-color: var(--yt-sys-color-baseline--text-primary, #0f0f0f);

    border-color: var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 10%));
    background: color-mix(in oklch, var(--yt-sys-color-baseline--text-secondary, #606060) 8%, transparent);
  }

  .track-original-badge {
    display: inline-flex;
    flex-shrink: 0;
    justify-content: center;
    align-items: center;
    height: 22px;
    padding: 0 7px;
    border: 1px solid var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 12%));
    border-radius: 5px;
    background: var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 8%));
    color: var(--yt-sys-color-baseline--text-primary, #0f0f0f);
    font-weight: 800;
    font-size: 0.95rem;
    letter-spacing: 0.07em;
  }
</style>

import { buildTrackButtons, refreshButton } from "./TrackChoice.button-data";
import { onButtonClick } from "@/lib/messaging/cross-world-messenger";
import { PanelTrackMode, TrackKind } from "@/types";
import { untrack } from "svelte";
import { SvelteMap } from "svelte/reactivity";

export interface TrackChoiceParams {
  readonly kind: TrackKind;
  readonly mode: PanelTrackMode;
  readonly disabled: boolean;
  readonly disabledModes: readonly PanelTrackMode[];
  readonly onmodechange: (mode: PanelTrackMode) => void;
}

export function createTrackChoiceState(params: TrackChoiceParams) {
  const buttons = $derived(buildTrackButtons(params.kind));

  const isAudio = $derived(params.kind === TrackKind.Audio);
  const kindLabel = $derived(isAudio ? "Audio language" : "Captions");
  const originalSubLabel = $derived(isAudio ? "The creator's baked-in audio track" : "The video's original caption track");
  const accessibleLabel = $derived(isAudio ? "Audio language" : "Caption language");
  const isAlternativeModeAbsent = $derived(buttons.length > 0 && params.disabledModes.length >= buttons.length - 1);

  const elements = new SvelteMap<string, HTMLElement>();

  function refresh(button: (typeof buttons)[number]) {
    const elButton = elements.get(button.id);
    if (!elButton) {
      return;
    }

    const isModeDisabled = params.disabledModes.includes(button.mode);
    refreshButton({
      elButton,
      label: button.label,
      isSelected: params.mode === button.mode,
      isDisabled: params.disabled || isModeDisabled
    });
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
    void params.mode;
    void params.disabled;
    void params.disabledModes;
    for (const button of buttons) {
      refresh(button);
    }
  });

  $effect(() => onButtonClick(buttonId => {
    untrack(() => {
      const match = buttons.find(button => button.id === buttonId);
      if (match) {
        params.onmodechange(match.mode);
      }
    });
  }));

  function handleSegmentedKeydown(e: KeyboardEvent) {
    const isArrowKey = e.key === "ArrowLeft" || e.key === "ArrowRight";
    if (!isArrowKey) {
      return;
    }

    e.preventDefault();
    const iCurrent = buttons.findIndex(button => button.mode === params.mode);
    const delta = e.key === "ArrowRight" ? 1 : -1;

    let iNext = iCurrent;
    for (let i = 0; i < buttons.length; i++) {
      iNext = (iNext + delta + buttons.length) % buttons.length;
      const isCandidateEnabled = !params.disabledModes.includes(buttons[iNext].mode);
      if (isCandidateEnabled) {
        break;
      }
    }

    const isEnabledTargetAbsent = iNext === iCurrent;
    if (isEnabledTargetAbsent) {
      return;
    }

    const nextButton = buttons[iNext];
    params.onmodechange(nextButton.mode);
    const elNext = elements.get(nextButton.id);
    queueMicrotask(() => elNext?.querySelector("button")?.focus());
  }

  return {
    get buttons() {
      return buttons;
    },
    get kindLabel() {
      return kindLabel;
    },
    get originalSubLabel() {
      return originalSubLabel;
    },
    get accessibleLabel() {
      return accessibleLabel;
    },
    get isAlternativeModeAbsent() {
      return isAlternativeModeAbsent;
    },
    createAttacher,
    handleSegmentedKeydown
  };
}

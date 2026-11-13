import { required } from "@/lib/required";
import { buildTrackButtons, refreshButton } from "./TrackChoice.button-data";
import { onButtonClick } from "@/lib/messaging/cross-world-messenger";
import type { PanelTrackMode} from "@/types";
import { type Prettify, TrackKind } from "@/types";
import { untrack } from "svelte";
import { SvelteMap } from "svelte/reactivity";

export type TrackChoiceParams = Prettify<{
  readonly kind: TrackKind;
  readonly mode: PanelTrackMode;
  readonly disabled: boolean;
  readonly disabledModes: readonly PanelTrackMode[];
  readonly onmodechange: (mode: PanelTrackMode) => void;
}>;

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
      const isHtmlElement = elTarget instanceof HTMLElement;
      if (!isHtmlElement) {
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

  function findButton(buttonId: string) {
    return buttons.find(button => button.id === buttonId);
  }

  $effect(() => onButtonClick(buttonId => {
    untrack(() => {
      const match = findButton(buttonId);
      if (match) {
        params.onmodechange(match.mode);
      }
    });
  }));

  function handleSegmentedKeydown(event: KeyboardEvent) {
    const isArrowKey = event.key === "ArrowLeft" || event.key === "ArrowRight";
    if (!isArrowKey) {
      return;
    }

    event.preventDefault();
    const iCurrent = buttons.findIndex(button => button.mode === params.mode);
    const delta = event.key === "ArrowRight" ? 1 : -1;

    const iCandidates = buttons.map((_, iStep) => (((iCurrent + (iStep + 1) * delta) % buttons.length) + buttons.length) % buttons.length);
    const iNext = iCandidates.find(iCandidate => !params.disabledModes.includes(required(buttons[iCandidate]).mode)) ?? iCurrent;

    const isEnabledTargetAbsent = iNext === iCurrent;
    if (isEnabledTargetAbsent) {
      return;
    }

    const nextButton = required(buttons[iNext]);
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

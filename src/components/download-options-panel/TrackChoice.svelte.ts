import { buildTrackButtons, refreshButton } from "./TrackChoice.button-data";
import { onButtonClick } from "@/lib/messaging/cross-world-messenger";
import { attachFmtStr } from "@/lib/ui/polymer-utils";
import { PanelTrackMode, TrackKind } from "@/types";
import { untrack } from "svelte";
import { SvelteMap } from "svelte/reactivity";

export interface TrackChoiceParams {
  readonly kind: TrackKind;
  readonly mode: PanelTrackMode;
  readonly disabled: boolean;
  readonly onmodechange: (mode: PanelTrackMode) => void;
}

export { attachFmtStr };

export function createTrackChoiceState(params: TrackChoiceParams) {
  const buttons = $derived(buildTrackButtons(params.kind));

  const isAudio = $derived(params.kind === TrackKind.Audio);
  const kindLabel = $derived(isAudio ? "Audio language" : "Captions");
  const originalSubLabel = $derived(isAudio ? "The creator's baked-in audio track" : "The video's original caption track");
  const accessibleLabel = $derived(isAudio ? "Audio language" : "Caption language");

  const elements = new SvelteMap<string, HTMLElement>();

  function refresh(button: (typeof buttons)[number]) {
    const elButton = elements.get(button.id);
    if (!elButton) {
      return;
    }

    refreshButton({
      elButton,
      label: button.label,
      isSelected: params.mode === button.mode,
      isDisabled: params.disabled
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

  function handleSegKeydown(e: KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") {
      return;
    }

    e.preventDefault();
    const currentIndex = buttons.findIndex(btn => btn.mode === params.mode);
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (currentIndex + delta + buttons.length) % buttons.length;
    const nextButton = buttons[nextIndex];
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
    createAttacher,
    handleSegKeydown
  };
}

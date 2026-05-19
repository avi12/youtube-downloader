import {
  ALL_TOGGLE_BUTTONS,
  TOGGLE_BUTTON_GROUPS,
  type ToggleButtonGroup
} from "./helpers/playlist-toggle-button-groups";
import { DATA_BUTTON_ID_ATTR, sendButtonData } from "@/lib/ui/polymer-utils";
import {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  IconName,
  PlaylistDownloadMode,
  PlaylistOutputMode,
  type DownloadTypePreference
} from "@/types";
import { SvelteMap } from "svelte/reactivity";

const SEGMENTED_IDS = new Set([
  ...TOGGLE_BUTTON_GROUPS.speed.map(button => button.id),
  ...TOGGLE_BUTTON_GROUPS.output.map(button => button.id)
]);

type ResolveButtonTypeParams = {
  isActive: boolean;
  isSegmented: boolean;
};
function resolveButtonType({ isActive }: ResolveButtonTypeParams) {
  return isActive ? ButtonType.Filled : ButtonType.Outline;
}

export function createPlaylistToggleButtons(state: {
  downloadMode: PlaylistDownloadMode;
  outputMode: PlaylistOutputMode;
  effectiveDownloadType: DownloadTypePreference;
  isDownloading: boolean;
}) {
  const elements = new SvelteMap<string, HTMLElement>();

  function refresh(buttonId: string) {
    const elButton = elements.get(buttonId);
    if (!elButton) {
      return;
    }

    const buttonDefinition = ALL_TOGGLE_BUTTONS.find(button => button.id === buttonId);
    if (!buttonDefinition) {
      return;
    }

    elButton.setAttribute(DATA_BUTTON_ID_ATTR, buttonId);

    const isActive = buttonDefinition.isActive(state);
    const isSegmented = SEGMENTED_IDS.has(buttonId);

    sendButtonData({
      elButton,
      data: {
        iconName: IconName.None,
        title: buttonDefinition.label,
        accessibilityText: buttonDefinition.label,
        style: isSegmented && isActive ? ButtonStyle.Overlay : ButtonStyle.Mono,
        type: resolveButtonType({
          isActive,
          isSegmented
        }),
        buttonSize: isSegmented ? ButtonSize.XSmall : ButtonSize.Default,
        state: state.isDownloading ? ButtonState.Disabled : ButtonState.Active,
        isFullWidth: false,
        isDisabled: state.isDownloading,
        tooltip: buttonDefinition.tooltip
      },
      ...(isSegmented && {
        a11y: {
          tabIndex: isActive ? 0 : -1,
          role: "radio",
          ariaChecked: String(isActive)
        }
      })
    });
  }

  function refreshAll() {
    for (const buttonDefinition of ALL_TOGGLE_BUTTONS) {
      refresh(buttonDefinition.id);
    }
  }

  function createAttacher(buttonDefinition: (typeof ALL_TOGGLE_BUTTONS)[number]) {
    return (elButton: Element) => {
      if (!(elButton instanceof HTMLElement)) {
        return;
      }

      elements.set(buttonDefinition.id, elButton);
      refresh(buttonDefinition.id);
    };
  }

  function makeSegKeydown(group: ToggleButtonGroup[]) {
    return (e: KeyboardEvent) => {
      const isArrowKey = e.key === "ArrowLeft" || e.key === "ArrowRight";
      if (!isArrowKey) {
        return;
      }

      e.preventDefault();
      const iCurrent = group.findIndex(button => button.isActive(state));
      const delta = e.key === "ArrowRight" ? 1 : -1;
      const iNext = (iCurrent + delta + group.length) % group.length;
      const nextButton = group[iNext];
      nextButton.onClick(state);
      const elNext = elements.get(nextButton.id);
      queueMicrotask(() => elNext?.querySelector<HTMLButtonElement>("button")?.focus());
    };
  }

  function handleClick(buttonId: string) {
    const match = ALL_TOGGLE_BUTTONS.find(button => button.id === buttonId);
    match?.onClick(state);
    return Boolean(match);
  }

  return {
    groups: TOGGLE_BUTTON_GROUPS,
    createAttacher,
    refreshAll,
    handleClick,
    speedKeydown: makeSegKeydown(TOGGLE_BUTTON_GROUPS.speed),
    outputKeydown: makeSegKeydown(TOGGLE_BUTTON_GROUPS.output)
  };
}

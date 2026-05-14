import { ALL_TOGGLE_BUTTONS, TOGGLE_BUTTON_GROUPS } from "./playlist-toggle-button-groups";
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

    const buttonDefinition = ALL_TOGGLE_BUTTONS.find(btn => btn.id === buttonId);
    if (!buttonDefinition) {
      return;
    }

    if (!elButton.hasAttribute(DATA_BUTTON_ID_ATTR)) {
      elButton.setAttribute(DATA_BUTTON_ID_ATTR, buttonId);
    }

    sendButtonData({
      elButton,
      data: {
        iconName: IconName.None,
        title: buttonDefinition.label,
        accessibilityText: buttonDefinition.label,
        style: ButtonStyle.Mono,
        type: buttonDefinition.isActive(state) ? ButtonType.Tonal : ButtonType.Outline,
        buttonSize: ButtonSize.Default,
        state: state.isDownloading ? ButtonState.Disabled : ButtonState.Active,
        isFullWidth: false,
        isDisabled: state.isDownloading,
        tooltip: buttonDefinition.tooltip
      }
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

  function handleClick(buttonId: string) {
    const match = ALL_TOGGLE_BUTTONS.find(button => button.id === buttonId);
    match?.onClick(state);
    return Boolean(match);
  }

  return {
    groups: TOGGLE_BUTTON_GROUPS,
    createAttacher,
    refreshAll,
    handleClick
  };
}

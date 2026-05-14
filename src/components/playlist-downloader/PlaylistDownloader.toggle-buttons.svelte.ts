import { ALL_TOGGLE_BUTTONS, TOGGLE_BUTTON_GROUPS, type ToggleButtonGroup } from "./playlist-toggle-button-groups";
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
  ...TOGGLE_BUTTON_GROUPS.speed.map(btn => btn.id),
  ...TOGGLE_BUTTON_GROUPS.output.map(btn => btn.id)
]);

function resolveButtonType(isActive: boolean, isSegmented: boolean) {
  if (isSegmented) {
    return isActive ? ButtonType.Filled : ButtonType.Text;
  }

  return isActive ? ButtonType.Tonal : ButtonType.Outline;
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

    const buttonDefinition = ALL_TOGGLE_BUTTONS.find(btn => btn.id === buttonId);
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
        style: ButtonStyle.Mono,
        type: resolveButtonType(isActive, isSegmented),
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
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") {
        return;
      }

      e.preventDefault();
      const currentIndex = group.findIndex(btn => btn.isActive(state));
      const delta = e.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (currentIndex + delta + group.length) % group.length;
      const nextButton = group[nextIndex];
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

import { sendButtonData } from "@/lib/polymer-utils";
import {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  IconName,
  PlaylistDownloadMode,
  PlaylistOutputMode
} from "@/types";
import { SvelteMap } from "svelte/reactivity";

type ToggleButtonConfig = {
  id: string;
  label: string;
  tooltip: string;
  isActive(): boolean;
  onClick(): void;
};

type ToggleState = {
  downloadMode: PlaylistDownloadMode;
  outputMode: PlaylistOutputMode;
};

export function createPlaylistToggleButtons(state: ToggleState) {
  const buttons: ToggleButtonConfig[] = [
    {
      id: "playlist-mode-fast",
      label: "Fast",
      tooltip: "Download all videos simultaneously",
      isActive: () => state.downloadMode === PlaylistDownloadMode.Fast,
      onClick() {
        state.downloadMode = PlaylistDownloadMode.Fast;
      }
    },
    {
      id: "playlist-mode-data-saver",
      label: "Data saver",
      tooltip: "Download videos one at a time to save bandwidth",
      isActive: () => state.downloadMode === PlaylistDownloadMode.DataSaver,
      onClick() {
        state.downloadMode = PlaylistDownloadMode.DataSaver;
      }
    },
    {
      id: "playlist-output-individual",
      label: "Individual files",
      tooltip: "Save each video as a separate file",
      isActive: () => state.outputMode === PlaylistOutputMode.Individual,
      onClick() {
        state.outputMode = PlaylistOutputMode.Individual;
      }
    },
    {
      id: "playlist-output-zip",
      label: "ZIP bundle",
      tooltip: "Bundle all videos into a single ZIP file",
      isActive: () => state.outputMode === PlaylistOutputMode.Zip,
      onClick() {
        state.outputMode = PlaylistOutputMode.Zip;
      }
    }
  ];

  const elements = new SvelteMap<string, HTMLElement>();

  function refresh(config: ToggleButtonConfig) {
    const elButton = elements.get(config.id);
    if (!elButton) {
      return;
    }

    if (!elButton.hasAttribute("data-ytdl-button-id")) {
      elButton.setAttribute("data-ytdl-button-id", config.id);
    }

    sendButtonData(elButton, {
      iconName: IconName.None,
      title: config.label,
      accessibilityText: config.label,
      style: ButtonStyle.Mono,
      type: config.isActive() ? ButtonType.Tonal : ButtonType.Outline,
      buttonSize: ButtonSize.Default,
      state: ButtonState.Active,
      isFullWidth: false,
      isDisabled: false,
      tooltip: config.tooltip
    });
  }

  function refreshAll() {
    for (const config of buttons) {
      refresh(config);
    }
  }

  function createAttacher(config: ToggleButtonConfig) {
    return (elButton: Element) => {
      if (!(elButton instanceof HTMLElement)) {
        return;
      }

      elements.set(config.id, elButton);
      refresh(config);
    };
  }

  function handleClick(buttonId: string) {
    const match = buttons.find(button => button.id === buttonId);
    match?.onClick();
    return Boolean(match);
  }

  return { buttons, createAttacher, refreshAll, handleClick };
}

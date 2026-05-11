import { DATA_BUTTON_ID_ATTR, sendButtonData } from "@/lib/ui/polymer-utils";
import {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  DownloadType,
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
  const groups = {
    speed: [
      {
        id: "playlist-mode-fast",
        label: "In parallel",
        tooltip: "Download all in parallel",
        isActive: () => state.downloadMode === PlaylistDownloadMode.Fast,
        onClick() {
          state.downloadMode = PlaylistDownloadMode.Fast;
        }
      },
      {
        id: "playlist-mode-data-saver",
        label: "One at a time",
        tooltip: "Download one at a time",
        isActive: () => state.downloadMode === PlaylistDownloadMode.DataSaver,
        onClick() {
          state.downloadMode = PlaylistDownloadMode.DataSaver;
        }
      }
    ],
    output: [
      {
        id: "playlist-output-individual",
        label: "Separate files",
        tooltip: "Save as separate files",
        isActive: () => state.outputMode === PlaylistOutputMode.Individual,
        onClick() {
          state.outputMode = PlaylistOutputMode.Individual;
        }
      },
      {
        id: "playlist-output-zip",
        label: "Single ZIP",
        tooltip: "Bundle into one ZIP",
        isActive: () => state.outputMode === PlaylistOutputMode.Zip,
        onClick() {
          state.outputMode = PlaylistOutputMode.Zip;
        }
      }
    ],
    type: [
      {
        id: "playlist-type-auto",
        label: "Auto",
        tooltip: "Auto: audio for music, video+audio for rest",
        isActive: () => state.effectiveDownloadType === DownloadType.Auto,
        onClick() {
          state.effectiveDownloadType = DownloadType.Auto;
        }
      },
      {
        id: "playlist-type-video-audio",
        label: "Video + audio",
        tooltip: "Video + audio stream",
        isActive: () => state.effectiveDownloadType === DownloadType.VideoAndAudio,
        onClick() {
          state.effectiveDownloadType = DownloadType.VideoAndAudio;
        }
      },
      {
        id: "playlist-type-video",
        label: "Video only",
        tooltip: "Video stream only",
        isActive: () => state.effectiveDownloadType === DownloadType.Video,
        onClick() {
          state.effectiveDownloadType = DownloadType.Video;
        }
      },
      {
        id: "playlist-type-audio",
        label: "Audio only",
        tooltip: "Audio stream only",
        isActive: () => state.effectiveDownloadType === DownloadType.Audio,
        onClick() {
          state.effectiveDownloadType = DownloadType.Audio;
        }
      }
    ]
  } satisfies Record<string, {
    id: string;
    label: string;
    tooltip: string;
    isActive(): boolean;
    onClick(): void;
  }[]>;

  const allButtons = [...groups.speed, ...groups.output, ...groups.type];
  const elements = new SvelteMap<string, HTMLElement>();

  function refresh(buttonDefinition: (typeof allButtons)[number]) {
    const elButton = elements.get(buttonDefinition.id);
    if (!elButton) {
      return;
    }

    if (!elButton.hasAttribute(DATA_BUTTON_ID_ATTR)) {
      elButton.setAttribute(DATA_BUTTON_ID_ATTR, buttonDefinition.id);
    }

    sendButtonData({
      elButton,
      data: {
        iconName: IconName.None,
        title: buttonDefinition.label,
        accessibilityText: buttonDefinition.label,
        style: ButtonStyle.Mono,
        type: buttonDefinition.isActive() ? ButtonType.Tonal : ButtonType.Outline,
        buttonSize: ButtonSize.Default,
        state: state.isDownloading ? ButtonState.Disabled : ButtonState.Active,
        isFullWidth: false,
        isDisabled: state.isDownloading,
        tooltip: buttonDefinition.tooltip
      }
    });
  }

  function refreshAll() {
    for (const buttonDefinition of allButtons) {
      refresh(buttonDefinition);
    }
  }

  function createAttacher(buttonDefinition: (typeof allButtons)[number]) {
    return (elButton: Element) => {
      if (!(elButton instanceof HTMLElement)) {
        return;
      }

      elements.set(buttonDefinition.id, elButton);
      refresh(buttonDefinition);
    };
  }

  function handleClick(buttonId: string) {
    const match = allButtons.find(button => button.id === buttonId);
    match?.onClick();
    return Boolean(match);
  }

  return {
    groups,
    createAttacher,
    refreshAll,
    handleClick
  };
}

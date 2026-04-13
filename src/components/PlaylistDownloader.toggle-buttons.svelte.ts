import { sendButtonData } from "@/lib/polymer-utils";
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
  effectiveDownloadType: DownloadTypePreference;
};

export function createPlaylistToggleButtons(state: ToggleState) {
  const buttons: ToggleButtonConfig[] = [
    {
      id: "playlist-mode-fast",
      label: "All at once",
      tooltip: "Download every video in parallel - fastest, uses more bandwidth",
      isActive: () => state.downloadMode === PlaylistDownloadMode.Fast,
      onClick() {
        state.downloadMode = PlaylistDownloadMode.Fast;
      }
    },
    {
      id: "playlist-mode-data-saver",
      label: "One at a time",
      tooltip: "Download videos sequentially - slower, saves bandwidth",
      isActive: () => state.downloadMode === PlaylistDownloadMode.DataSaver,
      onClick() {
        state.downloadMode = PlaylistDownloadMode.DataSaver;
      }
    },
    {
      id: "playlist-output-individual",
      label: "Separate files",
      tooltip: "Save each video as its own file in your downloads folder",
      isActive: () => state.outputMode === PlaylistOutputMode.Individual,
      onClick() {
        state.outputMode = PlaylistOutputMode.Individual;
      }
    },
    {
      id: "playlist-output-zip",
      label: "Single ZIP",
      tooltip: "Bundle every video into one ZIP archive",
      isActive: () => state.outputMode === PlaylistOutputMode.Zip,
      onClick() {
        state.outputMode = PlaylistOutputMode.Zip;
      }
    },
    {
      id: "playlist-type-auto",
      label: "Auto",
      tooltip: "Music videos as audio, everything else as video + audio",
      isActive: () => state.effectiveDownloadType === "auto",
      onClick() {
        state.effectiveDownloadType = "auto";
      }
    },
    {
      id: "playlist-type-video-audio",
      label: "Video + audio",
      tooltip: "Download every video with its audio muxed in",
      isActive: () => state.effectiveDownloadType === DownloadType.VideoAndAudio,
      onClick() {
        state.effectiveDownloadType = DownloadType.VideoAndAudio;
      }
    },
    {
      id: "playlist-type-video",
      label: "Video only",
      tooltip: "Download video stream only, no audio",
      isActive: () => state.effectiveDownloadType === DownloadType.Video,
      onClick() {
        state.effectiveDownloadType = DownloadType.Video;
      }
    },
    {
      id: "playlist-type-audio",
      label: "Audio only",
      tooltip: "Download audio stream only (useful for music or podcasts)",
      isActive: () => state.effectiveDownloadType === DownloadType.Audio,
      onClick() {
        state.effectiveDownloadType = DownloadType.Audio;
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

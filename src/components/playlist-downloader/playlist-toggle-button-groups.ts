import { DownloadType, PlaylistDownloadMode, PlaylistOutputMode, type DownloadTypePreference } from "@/types";

export type ToggleButtonState = {
  downloadMode: PlaylistDownloadMode;
  outputMode: PlaylistOutputMode;
  effectiveDownloadType: DownloadTypePreference;
};

export type ToggleButtonGroup = {
  id: string;
  label: string;
  tooltip: string;
  isActive(state: ToggleButtonState): boolean;
  onClick(state: ToggleButtonState): void;
};

export const TOGGLE_BUTTON_GROUPS: Record<string, ToggleButtonGroup[]> = {
  speed: [
    {
      id: "playlist-mode-fast",
      label: "In parallel",
      tooltip: "Download all in parallel",
      isActive: (state: ToggleButtonState) => state.downloadMode === PlaylistDownloadMode.Fast,
      onClick(state: ToggleButtonState) {
        state.downloadMode = PlaylistDownloadMode.Fast;
      }
    },
    {
      id: "playlist-mode-data-saver",
      label: "One at a time",
      tooltip: "Download one at a time",
      isActive: (state: ToggleButtonState) => state.downloadMode === PlaylistDownloadMode.DataSaver,
      onClick(state: ToggleButtonState) {
        state.downloadMode = PlaylistDownloadMode.DataSaver;
      }
    }
  ],
  output: [
    {
      id: "playlist-output-individual",
      label: "Separate files",
      tooltip: "Save as separate files",
      isActive: (state: ToggleButtonState) => state.outputMode === PlaylistOutputMode.Individual,
      onClick(state: ToggleButtonState) {
        state.outputMode = PlaylistOutputMode.Individual;
      }
    },
    {
      id: "playlist-output-zip",
      label: "Single ZIP",
      tooltip: "Bundle into one ZIP",
      isActive: (state: ToggleButtonState) => state.outputMode === PlaylistOutputMode.Zip,
      onClick(state: ToggleButtonState) {
        state.outputMode = PlaylistOutputMode.Zip;
      }
    }
  ],
  type: [
    {
      id: "playlist-type-auto",
      label: "Auto",
      tooltip: "Auto: audio for music, video+audio for rest",
      isActive: (state: ToggleButtonState) => state.effectiveDownloadType === DownloadType.Auto,
      onClick(state: ToggleButtonState) {
        state.effectiveDownloadType = DownloadType.Auto;
      }
    },
    {
      id: "playlist-type-video-audio",
      label: "Video + audio",
      tooltip: "Video + audio stream",
      isActive: (state: ToggleButtonState) => state.effectiveDownloadType === DownloadType.VideoAndAudio,
      onClick(state: ToggleButtonState) {
        state.effectiveDownloadType = DownloadType.VideoAndAudio;
      }
    },
    {
      id: "playlist-type-video",
      label: "Video only",
      tooltip: "Video stream only",
      isActive: (state: ToggleButtonState) => state.effectiveDownloadType === DownloadType.Video,
      onClick(state: ToggleButtonState) {
        state.effectiveDownloadType = DownloadType.Video;
      }
    },
    {
      id: "playlist-type-audio",
      label: "Audio only",
      tooltip: "Audio stream only",
      isActive: (state: ToggleButtonState) => state.effectiveDownloadType === DownloadType.Audio,
      onClick(state: ToggleButtonState) {
        state.effectiveDownloadType = DownloadType.Audio;
      }
    }
  ]
};

export const ALL_TOGGLE_BUTTONS = [
  ...TOGGLE_BUTTON_GROUPS.speed,
  ...TOGGLE_BUTTON_GROUPS.output,
  ...TOGGLE_BUTTON_GROUPS.type
];

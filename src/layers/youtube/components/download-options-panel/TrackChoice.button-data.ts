import { sendButtonData } from "@/lib/ui/polymer-utils";
import {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  IconName,
  PanelTrackMode,
  TrackKind
} from "@/types";

export function buildTrackButtons(kind: TrackKind) {
  return [
    {
      id: `track-match-video-${kind}`,
      label: "Match video",
      mode: PanelTrackMode.MatchVideo
    },
    {
      id: `track-original-${kind}`,
      label: "Original",
      mode: PanelTrackMode.Original
    },
    {
      id: `track-custom-${kind}`,
      label: "Custom",
      mode: PanelTrackMode.Custom
    }
  ];
}

export function refreshButton(params: {
  elButton: HTMLElement;
  label: string;
  isSelected: boolean;
  isDisabled: boolean;
}) {
  sendButtonData({
    elButton: params.elButton,
    data: {
      iconName: IconName.None,
      title: params.label,
      accessibilityText: params.label,
      style: ButtonStyle.Mono,
      type: params.isSelected ? ButtonType.Filled : ButtonType.Text,
      buttonSize: ButtonSize.XSmall,
      state: params.isDisabled ? ButtonState.Disabled : ButtonState.Active,
      isFullWidth: false,
      isDisabled: params.isDisabled,
      tooltip: ""
    },
    a11y: {
      tabIndex: params.isSelected ? 0 : -1,
      role: "radio",
      ariaChecked: String(params.isSelected)
    }
  });
}

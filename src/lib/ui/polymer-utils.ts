import type {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  IconName,
  TooltipPlacement,
  TooltipStyle
} from "@/types";
import { CrossWorldMessage, crossWorldMessenger } from "~/lib/messaging/cross-world-messenger";

export const PAPER_PROGRESS_THEME = {
  "--paper-progress-active-color": "var(--yt-spec-call-to-action, rgb(62 166 255))",
  "--paper-progress-container-color": "transparent"
};

export const PAPER_INPUT_THEME = {
  "--paper-input-container-color": "var(--yt-spec-text-secondary, #aaa)",
  "--paper-input-container-focus-color": "var(--yt-spec-call-to-action, rgb(62 166 255))",
  "--paper-input-container-input-color": "var(--yt-spec-text-primary, #f1f1f1)"
};

export function applyPolymerCustomStyles(
  element: Element,
  styles: Record<string, string>
) {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  for (const [property, value] of Object.entries(styles)) {
    element.style.setProperty(property, value);
  }
}

// The element must already have a data-ytdl-button-id attribute set.
export function sendButtonData(elButton: Element, data: {
  accessibilityText: string;
  buttonSize: ButtonSize;
  style: ButtonStyle;
  type: ButtonType;
  iconName?: IconName | (string & {});
  iconImage?: {
    url: string;
    width: number;
    height: number;
  };
  title?: string;
  tooltip?: string;
  tooltipData?: {
    tooltipViewModel?: {
      tooltipText: string;
      placement: TooltipPlacement;
      style: TooltipStyle;
    };
  };
  state?: ButtonState;
  isDisabled?: boolean;
  isFullWidth?: boolean;
  enableFullWidthMargins?: boolean;
  enableIconButton?: boolean;
  accessibilityId?: string;
  onTap?: Record<string, unknown>;
  targetId?: string;
  trackingParams?: string;
  shouldLogGestures?: boolean;
  useYoutubeLoggingDirectives?: boolean;
  loggingDirectives?: Record<string, unknown>;
}) {
  void crossWorldMessenger.sendMessage(CrossWorldMessage.SetButtonData, {
    selector: `[data-ytdl-button-id="${elButton.getAttribute("data-ytdl-button-id")}"]`,
    data
  });
}

export type ButtonViewModelData = Parameters<typeof sendButtonData>[1];

import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import type {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  IconName,
  TooltipPlacement,
  TooltipStyle
} from "@/types";

// Click-target attribute for buttons inside the download panel / playlist UI.
// The panel container reads this attribute on the click event's target to dispatch
// to the right handler without per-button addEventListener bookkeeping.
export const DATA_BUTTON_ID_ATTR = "data-ytdl-button-id";

export const PAPER_PROGRESS_THEME = {
  "--paper-progress-active-color": "var(--yt-spec-call-to-action, rgb(62 166 255))",
  "--paper-progress-container-color": "transparent"
};

export function applyPolymerCustomStyles({ element, styles }: {
  element: Element;
  styles: Record<string, string>;
}) {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  for (const [property, value] of Object.entries(styles)) {
    element.style.setProperty(property, value);
  }
}

// The element must already have a data-ytdl-button-id attribute set.
export function sendButtonData({ elButton, data }: {
  elButton: Element;
  data: {
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
  };
}) {
  void crossWorldMessenger.sendMessage(CrossWorldMessage.SetButtonData, {
    selector: `[${DATA_BUTTON_ID_ATTR}="${elButton.getAttribute(DATA_BUTTON_ID_ATTR)}"]`,
    data
  });
}

export type ButtonViewModelData = Parameters<typeof sendButtonData>[0]["data"];

import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import type {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  IconName,
  Prettify,
  TooltipPlacement,
  TooltipStyle,
  YtIconName
} from "@/types";

export { DATA_SETTINGS_OPTIONS_ID_ATTR, attachSettingsOptions, isYtdSettingsOptionsRenderer } from "./polymer-settings-options";

export function attachIcon(icon: YtIconName) {
  return (elTarget: Element) => {
    const isHtmlElement = elTarget instanceof HTMLElement;
    if (!isHtmlElement) {
      return;
    }

    requestAnimationFrame(() => {
      const isConnected = elTarget.isConnected;
      if (isConnected) {
        elTarget.setAttribute("icon", icon);
      }
    });
  };
}

export const DATA_BUTTON_ID_ATTR = "data-ytdl-button-id";

export const PAPER_PROGRESS_THEME = {
  "--paper-progress-active-color": "var(--yt-sys-color-baseline--call-to-action, rgb(62 166 255))",
  "--paper-progress-container-color": "transparent"
};

export function applyPolymerCustomStyles({ element, styles }: {
  element: Element;
  styles: Record<string, string>;
}) {
  const isHtmlElement = element instanceof HTMLElement;
  if (!isHtmlElement) {
    return;
  }

  for (const [property, value] of Object.entries(styles)) {
    element.style.setProperty(property, value);
  }
}

export function sendButtonData({ elButton, data, a11y }: {
  elButton: Element;
  a11y?: {
    tabIndex: number;
    role: string;
    ariaChecked: string;
  };
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
  crossWorldMessenger.sendMessage(CrossWorldMessage.SetButtonData, {
    selector: `[${DATA_BUTTON_ID_ATTR}="${elButton.getAttribute(DATA_BUTTON_ID_ATTR)}"]`,
    data,
    a11y
  }).catch(() => {});
}

export type ButtonViewModelData = Prettify<Parameters<typeof sendButtonData>[0]["data"]>;

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
import type { YtFormattedStringElement } from "@/types/polymer-elements";

// Click-target attribute for buttons inside the download panel / playlist UI.
// The panel container reads this attribute on the click event's target to dispatch
// to the right handler without per-button addEventListener bookkeeping.
export const DATA_BUTTON_ID_ATTR = "data-ytdl-button-id";
export const DATA_FMT_STRING_ID_ATTR = "data-ytdl-fmtstr-id";
const DATA_FMT_STRING_TEXT_ATTR = "data-ytdl-text";
let fmtStringIdCounter = 0;

export const PAPER_PROGRESS_THEME = {
  "--paper-progress-active-color": "var(--yt-sys-color-baseline--call-to-action, rgb(62 166 255))",
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
  void crossWorldMessenger.sendMessage(CrossWorldMessage.SetButtonData, {
    selector: `[${DATA_BUTTON_ID_ATTR}="${elButton.getAttribute(DATA_BUTTON_ID_ATTR)}"]`,
    data,
    a11y
  });
}

export type ButtonViewModelData = Parameters<typeof sendButtonData>[0]["data"];

export function isYtFormattedString(elTarget: Element): elTarget is YtFormattedStringElement {
  return elTarget.tagName.toLowerCase() === "yt-formatted-string";
}

export function setFormattedStringText(elTarget: YtFormattedStringElement, textContent: string) {
  elTarget.text = { runs: [{ text: textContent }] };
}

export function sendFormattedStringText(elTarget: Element, textContent: string) {
  const fmtStringId = elTarget.getAttribute(DATA_FMT_STRING_ID_ATTR);
  void crossWorldMessenger.sendMessage(CrossWorldMessage.SetFormattedStringText, {
    selector: `[${DATA_FMT_STRING_ID_ATTR}="${fmtStringId}"]`,
    text: textContent
  });
}

export function attachFmtStr(elTarget: Element) {
  elTarget.setAttribute(DATA_FMT_STRING_ID_ATTR, `ytdl-fmt-${++fmtStringIdCounter}`);
  sendFormattedStringText(elTarget, elTarget.getAttribute(DATA_FMT_STRING_TEXT_ATTR) ?? "");

  const observer = new MutationObserver(() => {
    sendFormattedStringText(elTarget, elTarget.getAttribute(DATA_FMT_STRING_TEXT_ATTR) ?? "");
  });

  observer.observe(elTarget, { attributeFilter: [DATA_FMT_STRING_TEXT_ATTR] });

  return () => observer.disconnect();
}

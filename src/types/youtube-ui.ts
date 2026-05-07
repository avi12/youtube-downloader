import type { ButtonViewModelData } from "@/lib/ui/polymer-utils";

export type { ButtonViewModelData };
export {
  ButtonSize, ButtonState, ButtonStyle, ButtonType, IconName, TooltipPlacement, TooltipStyle
} from "./youtube-ui-enums";

export function isPolymerProgressElement(element: Element): element is TpYtPaperProgressElement {
  return "updateStyles" in element && "value" in element;
}

export interface YtButtonViewModelElement extends HTMLElement {
  data: ButtonViewModelData;
}

interface TpYtPaperDropdownMenuElement extends HTMLElement {
  receivedFocusFromKeyboard: boolean;
}

export interface TpYtPaperProgressElement extends HTMLElement {
  value: number;
  max: number;
  indeterminate: boolean;
  updateStyles(styles: Record<string, string>): void;
}

export interface TpYtIronDropdownElement extends HTMLElement {
  positionTarget: Element | null;
  horizontalAlign: "left" | "right";
  verticalAlign: "top" | "bottom";
  noOverlap: boolean;
  dynamicAlign: boolean;
  allowOutsideScroll: boolean;
  restoreFocusOnClose: boolean;
  opened: boolean;
  open(): void;
  close(): void;
  refit(): void;
}

declare global {
  interface HTMLElementTagNameMap {
    "yt-button-view-model": YtButtonViewModelElement;
    "tp-yt-paper-dropdown-menu": TpYtPaperDropdownMenuElement;
    "tp-yt-paper-progress": TpYtPaperProgressElement;
    "tp-yt-iron-dropdown": TpYtIronDropdownElement;
    "tp-yt-paper-listbox": HTMLElement;
    "tp-yt-paper-item": HTMLElement;
  }

}

import type { ButtonViewModelData } from "./youtube-button-enums";

/** YouTube-internal Polymer view model - values reverse-engineered from YouTube's runtime. */
export interface YtButtonViewModelElement extends HTMLElement {
  data: ButtonViewModelData;
}

/** @see https://github.com/PolymerElements/paper-dropdown-menu */
interface TpYtPaperDropdownMenuElement extends HTMLElement {
  receivedFocusFromKeyboard: boolean;
}

/** @see https://github.com/PolymerElements/paper-progress */
export interface TpYtPaperProgressElement extends HTMLElement {
  value: number;
  max: number;
  indeterminate: boolean;
  updateStyles(styles: Record<string, string>): void;
}

/** @see https://github.com/PolymerElements/paper-input */
export interface TpYtPaperInputElement extends HTMLElement {
  updateStyles(styles: Record<string, string>): void;
  label: string;
  value: string;
}

/** @see https://github.com/PolymerElements/iron-icon */
export interface YtIconElement extends HTMLElement {
  icon: string;
}

/** @see https://github.com/PolymerElements/iron-dropdown */
export interface TpYtIronDropdownElement extends HTMLElement {
  positionTarget: Element | null;
  fitInto: Element | Window;
  horizontalAlign: "left" | "right" | "center";
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
  interface HTMLVideoElement {
    // audioTracks is supported in all modern browsers but absent from some TS lib versions
    audioTracks?: {
      readonly length: number;
      [index: number]: {
        enabled: boolean;
        language: string;
        id: string;
      };
      [Symbol.iterator](): IterableIterator<{
        enabled: boolean;
        language: string;
        id: string;
      }>;
    };
  }

  interface HTMLElementTagNameMap {
    "yt-icon": YtIconElement;
    "yt-button-view-model": YtButtonViewModelElement;
    "tp-yt-paper-dropdown-menu": TpYtPaperDropdownMenuElement;
    "tp-yt-paper-progress": TpYtPaperProgressElement;
    "tp-yt-paper-input": TpYtPaperInputElement;
    "tp-yt-iron-dropdown": TpYtIronDropdownElement;
    "tp-yt-paper-listbox": HTMLElement;
    "tp-yt-paper-item": HTMLElement;
  }
}

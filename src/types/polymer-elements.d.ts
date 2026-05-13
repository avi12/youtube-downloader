import type { YtIconName } from "./youtube";
import type { HTMLAttributes } from "svelte/elements";

declare module "svelte/elements" {
  interface SvelteHTMLElements {
    "yt-icon": HTMLAttributes<HTMLElement> & {
      /** The icon to display, in `"iconset:name"` format (e.g. `YtIconName.Autorenew`). */
      icon?: YtIconName | (string & {});
      /** Fallback image URL when the icon cannot be found in the iconset. */
      src?: string;
      /** The theme to apply from the iconset's theme map. */
      theme?: string;
      /** Accessible label for the icon (maps to `aria-label` on the inner SVG). */
      alt?: string;
    };
    "yt-button-view-model": HTMLAttributes<HTMLElement> & {
      class?: string;
      "aria-label"?: string;
      onclick?: (e: MouseEvent) => void;
      onkeydown?: (e: KeyboardEvent) => void;
      role?: string;
      tabindex?: string | number;
    };
    "tp-yt-paper-progress": HTMLAttributes<HTMLElement> & {
      value?: number;
      max?: number;
      indeterminate?: boolean;
      class?: string;
      "aria-label"?: string;
      "aria-valuetext"?: string;
    };
    "tp-yt-paper-spinner-lite": HTMLAttributes<HTMLElement> & {
      active?: boolean;
    };
    "tp-yt-paper-input": HTMLAttributes<HTMLElement> & {
      id?: string;
      value?: string;
      label?: string;
      disabled?: boolean | undefined;
      invalid?: boolean | undefined;
      "error-message"?: string | undefined;
      "aria-describedby"?: string | undefined;
      "aria-invalid"?: boolean | undefined;
      autocomplete?: string;
      oninput?: (e: Event) => void;
    };
    "tp-yt-paper-dropdown-menu": HTMLAttributes<HTMLElement> & {
      id?: string;
      class?: string;
      label?: string;
      disabled?: boolean | undefined;
      "aria-label"?: string;
      "keyboard-focused"?: string;
    };
    "tp-yt-paper-menu-button": HTMLAttributes<HTMLElement>;
    "tp-yt-iron-dropdown": HTMLAttributes<HTMLElement>;
    "ytd-menu-popup-renderer": HTMLAttributes<HTMLElement> & {
      slot?: string;
      id?: string;
    };
    "tp-yt-paper-listbox": HTMLAttributes<HTMLElement> & {
      slot?: string;
      "attr-for-selected"?: string;
      "aria-label"?: string;
      role?: string;
      selected?: string | number;
    };
    "tp-yt-paper-item": HTMLAttributes<HTMLElement> & {
      "aria-selected"?: boolean | string;
      "data-value"?: string | number;
      role?: string;
      tabindex?: string | number;
    };
    "tp-yt-paper-checkbox": HTMLAttributes<HTMLElement> & {
      checked?: "" | undefined;
      indeterminate?: "" | undefined;
      disabled?: "" | undefined;
      "aria-label"?: string;
      onchange?: (e: Event) => void;
    };
    "yt-chip-cloud-chip-renderer": HTMLAttributes<HTMLElement> & {
      "chip-style"?: string;
      selected?: "" | undefined;
      role?: string;
      "aria-checked"?: boolean | string;
      onclick?: (e: MouseEvent) => void;
    };
    "ytd-popup-container": HTMLAttributes<HTMLElement>;
    "yt-dynamic-text-view-model": HTMLAttributes<HTMLElement>;
    "yt-formatted-string": HTMLAttributes<HTMLElement> & {
      class?: string;
      "split-lines"?: boolean;
      "force-default-style"?: boolean;
      dir?: string;
      "data-ytdl-text"?: string;
    };
  }
}

export interface YtFormattedStringElement extends HTMLElement {
  text: { runs: { text: string }[] };
}

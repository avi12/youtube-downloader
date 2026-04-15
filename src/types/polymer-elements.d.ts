import type { HTMLAttributes } from "svelte/elements";

declare module "svelte/elements" {
  interface SvelteHTMLElements {
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
    "ytd-popup-container": HTMLAttributes<HTMLElement>;
    "yt-dynamic-text-view-model": HTMLAttributes<HTMLElement>;
    "yt-formatted-string": HTMLAttributes<HTMLElement> & {
      class?: string;
      "split-lines"?: boolean;
      "force-default-style"?: boolean;
      dir?: string;
    };
  }
}

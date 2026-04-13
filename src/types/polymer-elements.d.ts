declare namespace svelteHTML {
  interface IntrinsicElements {
    "yt-button-view-model": {
      class?: string;
      "aria-label"?: string;
      onclick?: (e: MouseEvent) => void;
      onkeydown?: (e: KeyboardEvent) => void;
      role?: string;
      tabindex?: string | number;
    };
    "tp-yt-paper-progress": {
      value?: number;
      max?: number;
      indeterminate?: boolean;
      class?: string;
      "aria-label"?: string;
      "aria-valuetext"?: string;
    };
    "tp-yt-paper-spinner-lite": {
      active?: boolean;
    };
    "tp-yt-paper-input": {
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
    "tp-yt-paper-dropdown-menu": {
      id?: string;
      class?: string;
      label?: string;
      disabled?: boolean | undefined;
      "aria-label"?: string;
      "keyboard-focused"?: string;
    };
    "tp-yt-paper-menu-button": Record<string, unknown>;
    "tp-yt-iron-dropdown": Record<string, unknown>;
    "ytd-menu-popup-renderer": {
      slot?: string;
      id?: string;
    };
    "tp-yt-paper-listbox": {
      slot?: string;
      "attr-for-selected"?: string;
      "aria-label"?: string;
      role?: string;
      selected?: string | number;
    };
    "tp-yt-paper-item": {
      "aria-selected"?: boolean | string;
      "data-value"?: string | number;
      role?: string;
      tabindex?: string | number;
    };
    "tp-yt-paper-checkbox": {
      checked?: "" | undefined;
      indeterminate?: "" | undefined;
      disabled?: "" | undefined;
      "aria-label"?: string;
      onchange?: (e: Event) => void;
    };
    "ytd-popup-container": Record<string, unknown>;
    "yt-dynamic-text-view-model": Record<string, unknown>;
    "yt-formatted-string": {
      class?: string;
      "split-lines"?: boolean;
      "force-default-style"?: boolean;
      dir?: string;
    };
  }
}

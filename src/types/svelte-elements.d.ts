import type { YtButtonViewModelElement } from "./youtube";
import type { HTMLAttributes } from "svelte/elements";

declare namespace svelteHTML {
  interface IntrinsicElements {
    "yt-button-view-model": HTMLAttributes<YtButtonViewModelElement>;
    "tp-yt-paper-dropdown-menu": HTMLAttributes<HTMLElement>;
    "tp-yt-paper-listbox": HTMLAttributes<HTMLElement>;
    "tp-yt-paper-item": HTMLAttributes<HTMLElement>;
  }
}

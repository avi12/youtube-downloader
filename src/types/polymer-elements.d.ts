/**
 * Type declarations for YouTube's Polymer custom elements.
 * Suppresses "Unknown html tag" warnings in Svelte templates.
 */

declare namespace svelteHTML {
  interface IntrinsicElements {
    "yt-button-view-model": Record<string, unknown>;
    "tp-yt-paper-progress": Record<string, unknown>;
    "tp-yt-paper-spinner-lite": Record<string, unknown>;
    "tp-yt-paper-input": Record<string, unknown>;
    "tp-yt-paper-dropdown-menu": Record<string, unknown>;
    "tp-yt-paper-menu-button": Record<string, unknown>;
    "tp-yt-iron-dropdown": Record<string, unknown>;
    "ytd-menu-popup-renderer": Record<string, unknown>;
    "ytd-popup-container": Record<string, unknown>;
    "yt-dynamic-text-view-model": Record<string, unknown>;
  }
}

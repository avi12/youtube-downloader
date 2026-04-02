export const PAPER_INPUT_THEME: Record<string, string> = {
  "--paper-input-container-color": "var(--yt-spec-text-secondary, #aaa)",
  "--paper-input-container-focus-color": "var(--yt-spec-call-to-action, rgb(62 166 255))",
  "--paper-input-container-input-color": "var(--yt-spec-text-primary, #f1f1f1)"
};

/**
 * Applies custom CSS properties to a Polymer element via the
 * customStyle API. This is the proper Polymer way to set CSS
 * custom properties that Shady DOM scoping doesn't override.
 */
export function applyPolymerCustomStyles(
  element: Element,
  styles: Record<string, string>
) {
  if (!("customStyle" in element) || !("updateStyles" in element)) {
    return;
  }

  const customStyle = element.customStyle;
  if (typeof customStyle !== "object" || !customStyle) {
    return;
  }

  Object.assign(customStyle, styles);

  if (typeof element.updateStyles === "function") {
    element.updateStyles();
  }
}

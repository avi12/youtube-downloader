export const PAPER_INPUT_THEME: Record<string, string> = {
  "--paper-input-container-color": "var(--yt-spec-text-secondary, #aaa)",
  "--paper-input-container-focus-color": "var(--yt-spec-call-to-action, rgb(62 166 255))",
  "--paper-input-container-input-color": "var(--yt-spec-text-primary, #f1f1f1)"
};

/**
 * Applies custom CSS properties to a Polymer element.
 * Uses customStyle + updateStyles() when available (Polymer-managed elements),
 * falls back to style.setProperty for dynamically created elements.
 */
export function applyPolymerCustomStyles(
  element: Element,
  styles: Record<string, string>
) {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  if (
    "customStyle" in element
    && typeof element.customStyle === "object"
    && element.customStyle !== null
    && "updateStyles" in element
    && typeof element.updateStyles === "function"
  ) {
    Object.assign(element.customStyle, styles);
    element.updateStyles();
    return;
  }

  for (const [property, value] of Object.entries(styles)) {
    element.style.setProperty(property, value);
  }
}

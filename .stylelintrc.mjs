import postcssHtml from "postcss-html";

export default {
  extends: ["stylelint-config-ccb"],
  plugins: ["@stylistic/stylelint-plugin"],
  customSyntax: postcssHtml({ svelte: true }),
  rules: {
    "@stylistic/indentation": 2,
    "selector-pseudo-class-no-unknown": [true, { ignorePseudoClasses: ["global"] }],
    // Custom properties in inline style attributes are always the first/only declaration
    "custom-property-empty-line-before": "never",
    // Extension targets Chrome 88+ and Firefox 78+ only — all modern CSS is supported
    "plugin/no-unsupported-browser-features": [true, {
      browsers: ["Chrome >= 88", "Firefox >= 78"],
      ignorePartialSupport: true
    }],
    // gap shorthand is valid in targeted browsers; both gap and row-gap are disallowed
    // by stylelint-config-ccb with no valid CSS-only alternative for flex column spacing
    "property-disallowed-list": null,
    // Font sizes intentionally match YouTube's design — accessibility handled at page level
    "a11y/font-size-is-readable": null,
    // :host is required for shadow-DOM component root styling; remove only "host" from ccb list
    "selector-pseudo-class-disallowed-list": [
      "-webkit-any", "-moz-any", "any", "matches",
      "root", "scope", "modal", "host-contex", "has"
    ],
    // color-mix() is required for theme-aware tonal button backgrounds; remove from ccb list
    "function-disallowed-list": [
      "rgba", "gray", "color-mod", "hsla", "hwb", "hsl", "lab", "oklab",
      "lch", "oklch", "color", "color-contrast", "round", "mod", "rem",
      "tan", "sin", "cos", "atan", "asin", "acos", "atan2",
      "anchor", "toggle", "expression", "image-set", "-webkit-image-set"
    ],
    // Add vendor-prefixed progress pseudo-elements to the ccb allowed list
    "selector-pseudo-element-allowed-list": [
      "first-letter", "first-line", "file-selector-button", "before", "after",
      "backdrop", "placeholder", "-moz-focus-inner",
      "-webkit-search-decoration", "-webkit-search-cancel-button",
      "-webkit-search-results-button", "-webkit-search-results-decoration",
      "-webkit-progress-bar", "-webkit-progress-value", "-moz-progress-bar"
    ],
    // :hover:not(:disabled) uses 3 pseudo-classes — raise limit from ccb default of 2
    "selector-max-pseudo-class": 3,
    // Svelte template expressions {…} in inline style attributes are not valid CSS syntax
    "csstree/validator": null,
    // Add progress (styled natively), section (adjacent combinator), svg (button icons)
    "selector-max-type": [0, { ignoreTypes: ["html", "body", "input", "textarea", "select", "a", "progress", "section", "svg"] }],
    // Allow 1 universal selector for the :global(*) box-sizing reset in the popup
    "selector-max-universal": [1, { ignoreAfterCombinators: ["+", ">"] }]
  },
  overrides: [
    {
      files: ["**/*.css"],
      customSyntax: "postcss"
    }
  ],
  ignoreFiles: ["src/scripts/**", "src/styles-injected/**"]
};

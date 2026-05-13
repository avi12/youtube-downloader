/**
 * Icon names for the `icon` attribute on `<yt-icon>` (iron-iconset-svg `icons:` set).
 * @see https://github.com/PolymerElements/iron-icons
 */
export const YtIconName = {
  Autorenew: "icons:autorenew",
  Check: "icons:check",
  CheckCircle: "icons:check-circle",
  Close: "icons:close",
  ErrorOutline: "icons:error-outline",
  Info: "icons:info",
  InfoOutline: "icons:info-outline",
  Language: "icons:language",
  Lock: "icons:lock",
  MicOff: "icons:mic-off",
  MoreVert: "icons:more-vert",
  Settings: "icons:settings",
  SubtitlesOutline: "icons:subtitles",
  Translate: "icons:translate",
  Warning: "icons:warning"
} as const;

export type YtIconName = (typeof YtIconName)[keyof typeof YtIconName];

/** YouTube-internal Polymer view model — values reverse-engineered from YouTube's runtime. */
export const TooltipPlacement = {
  Top: "TOOLTIP_VIEW_MODEL_PLACEMENT_TOP",
  Bottom: "TOOLTIP_VIEW_MODEL_PLACEMENT_BOTTOM",
  Left: "TOOLTIP_VIEW_MODEL_PLACEMENT_LEFT",
  Right: "TOOLTIP_VIEW_MODEL_PLACEMENT_RIGHT"
} as const;

export type TooltipPlacement = (typeof TooltipPlacement)[keyof typeof TooltipPlacement];

/** YouTube-internal Polymer view model — values reverse-engineered from YouTube's runtime. */
export const TooltipStyle = {
  Default: "TOOLTIP_VIEW_MODEL_STYLE_DEFAULT",
  Player: "TOOLTIP_VIEW_MODEL_STYLE_PLAYER"
} as const;

export type TooltipStyle = (typeof TooltipStyle)[keyof typeof TooltipStyle];

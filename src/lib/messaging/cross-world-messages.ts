export const CrossWorldMessage = {
  VideoData: "videoData",
  Navigation: "navigation",
  PanelContentReady: "panelContentReady",
  StreamError: "streamError",
  StreamData: "streamData",
  DownloadRequest: "downloadRequest",
  PanelClosed: "panelClosed",
  FilenameChanged: "filenameChanged",
  RequestVideoData: "requestVideoData",
  CancelDownload: "cancelDownload",
  ProxyFetch: "proxyFetch",
  IframePlayerReady: "iframePlayerReady",
  CancelRequest: "cancelRequest",
  SetButtonData: "setButtonData",
  CreateDropdown: "createDropdown",
  DropdownReady: "dropdownReady",
  CloseDropdown: "closeDropdown",
  DownloadProgress: "downloadProgress",
  DownloadViaIframe: "downloadViaIframe",
  StartBackgroundDownload: "startBackgroundDownload",
  OptionsUpdate: "optionsUpdate",
  IframeScrubSegment: "iframeScrubSegment",
  IframeScrubDebug: "iframeScrubDebug",
  StartIframeScrub: "startIframeScrub",
  SabrTemplateCaptured: "sabrTemplateCaptured",
  PullSabrTemplate: "pullSabrTemplate",
  RunProgressiveSabr: "runProgressiveSabr"
} as const;

export const CrossWorldSabrMessage = {
  SynthesizeSabrTemplate: "synthesizeSabrTemplate"
} as const;

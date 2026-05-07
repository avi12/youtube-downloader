// PostMessage envelope types exchanged with iframes hosted by the offscreen
// document (Chrome MV3) or background page (Firefox).
export const IframeHostMessageType = {
  TemplateReady: "ytdl:template-ready",
  ExecuteDownload: "ytdl-execute-download",
  ScrubDebug: "ytdl:scrub-debug",
  ScrubSegment: "ytdl:scrub-segment"
} as const;

export type IframeHostMessageType = (typeof IframeHostMessageType)[keyof typeof IframeHostMessageType];

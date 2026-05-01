// PostMessage envelope types exchanged with iframes hosted by the offscreen
// document (Chrome MV3) or background page (Firefox). Used for two channels:
//   1. Scrub iframe → host: debug logs and captured segments via parent.postMessage
//   2. Host → download iframe: forward DownloadRequest payloads via contentWindow.postMessage
export const IframeHostMessageType = {
  ScrubDebug: "ytdl:scrub-debug",
  ScrubSegment: "ytdl:scrub-segment",
  ExecuteDownload: "ytdl-execute-download"
} as const;

export type IframeHostMessageType = (typeof IframeHostMessageType)[keyof typeof IframeHostMessageType];

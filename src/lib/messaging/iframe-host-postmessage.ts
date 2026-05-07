export const IframeHostMessageType = {
  TemplateReady: "ytdl:template-ready",
  ExecuteDownload: "ytdl-execute-download"
} as const;

export type IframeHostMessageType = (typeof IframeHostMessageType)[keyof typeof IframeHostMessageType];

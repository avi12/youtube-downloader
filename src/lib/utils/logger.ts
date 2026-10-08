export const LogScope = {
  Main: "main",
  Isolated: "isolated",
  Background: "bg",
  Iframe: "iframe",
  Capture: "capture",
  PageSabrFetch: "page-sabr-fetch",
  Worker: "worker",
  Ffmpeg: "ffmpeg",
  Transcode: "transcode",
  Popup: "popup"
} as const;

export type LogScope = (typeof LogScope)[keyof typeof LogScope];

export function createLogger(scope: LogScope) {
  const prefix = `[ytdl:${scope}]`;
  return {
    debug: (...args: unknown[]) => console.debug(prefix, ...args),
    info: (...args: unknown[]) => console.info(prefix, ...args),
    warn: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args)
  };
}

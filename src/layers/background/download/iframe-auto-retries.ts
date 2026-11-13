export const MAX_IFRAME_AUTO_RETRIES = 2;
export const IFRAME_AUTO_RETRIES = new Map<string, number>();

export function clearIframeAutoRetry(videoId: string) {
  IFRAME_AUTO_RETRIES.delete(videoId);
}

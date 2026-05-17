import { getVideoIdFromUrl } from "@/lib/youtube/youtube-url";

export function getLockupRoot(elCard: Element) {
  const elLockup = elCard.tagName.toLowerCase() === "yt-lockup-view-model"
    ? elCard
    : elCard.querySelector("yt-lockup-view-model");
  return elLockup?.shadowRoot ?? null;
}

export function shadowFirst({ elCard, selector }: {
  elCard: Element;
  selector: string;
}) {
  return getLockupRoot(elCard)?.querySelector(selector) ?? elCard.querySelector(selector);
}

export function extractVideoId(elCard: Element) {
  const elLockup = elCard.tagName.toLowerCase() === "yt-lockup-view-model"
    ? elCard
    : elCard.querySelector("yt-lockup-view-model");
  const mainWorldId = elCard.getAttribute("data-ytdl-content-id")
    ?? elLockup?.getAttribute("data-ytdl-content-id");
  if (mainWorldId) {
    return mainWorldId;
  }

  const [, contentId] = shadowFirst({
    elCard,
    selector: "[class*='content-id-']"
  })?.className.match(/content-id-(\S+)/) ?? [];
  if (contentId) {
    return contentId;
  }

  const elLink = shadowFirst({
    elCard,
    selector: "a#video-title-link, a#video-title, a[href*='/watch?v=']"
  });
  if (!(elLink instanceof HTMLAnchorElement)) {
    return null;
  }

  return getVideoIdFromUrl(elLink.href);
}

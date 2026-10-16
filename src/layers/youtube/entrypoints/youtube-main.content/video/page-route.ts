export const WATCH_PATHNAME = "/watch";
const SHORTS_PATHNAME_PREFIX = "/shorts/";
const WATCH_VIDEO_ID_PARAM = "v";

export const PageRoute = {
  Watch: "watch",
  Shorts: "shorts",
  Other: "other"
} as const;

export type PageRoute = (typeof PageRoute)[keyof typeof PageRoute];

export function getPageRoute() {
  const { pathname } = location;
  if (pathname === WATCH_PATHNAME) {
    return PageRoute.Watch;
  }

  if (pathname.startsWith(SHORTS_PATHNAME_PREFIX)) {
    return PageRoute.Shorts;
  }

  return PageRoute.Other;
}

export function getRouteVideoId() {
  const route = getPageRoute();
  if (route === PageRoute.Watch) {
    return new URLSearchParams(location.search).get(WATCH_VIDEO_ID_PARAM);
  }

  if (route === PageRoute.Shorts) {
    return location.pathname.slice(SHORTS_PATHNAME_PREFIX.length).split("/")[0] || null;
  }

  return null;
}

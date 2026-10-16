import { cleanupGridUi, injectGridVideoButtons, stopGridButtonInjection } from "./grid-ui";
import { cleanupPanelUi } from "./panel-ui";
import { cleanupPlaylistUi, handlePlaylistVideoAdditions, injectPlaylistDownloaderUi } from "./playlist-ui";
import { CONTENT_OPTIONS } from "@/lib/ui/synced-stores.svelte";
import { WATCH_PAGE_PATHNAME } from "@/lib/youtube/youtube-url";

const HIDE_NATIVE_DOWNLOAD_CLASS = "ytdl-hide-native-download";
const HIDE_GRID_BUTTONS_CLASS = "ytdl-hide-grid-buttons";
const PLAYLIST_PATHNAME = "/playlist";
const NON_GRID_PATHNAMES = new Set<string>([WATCH_PAGE_PATHNAME, PLAYLIST_PATHNAME]);

export function setNativeDownloadVisibility(isVisible: boolean) {
  document.documentElement.classList.toggle(HIDE_NATIVE_DOWNLOAD_CLASS, !isVisible);
}

type SyncGridDownloadButtonsParams = {
  pathname: string;
  context: InstanceType<typeof ContentScriptContext>;
};
// Switching off fades the mounted buttons out and stops mounting new ones, switching on brings both back
export function syncGridDownloadButtons({ pathname, context }: SyncGridDownloadButtonsParams) {
  const isEnabled = CONTENT_OPTIONS.isShowGridDownloadButtons;
  document.documentElement.classList.toggle(HIDE_GRID_BUTTONS_CLASS, !isEnabled);

  if (!isEnabled) {
    stopGridButtonInjection();
    return;
  }

  if (NON_GRID_PATHNAMES.has(pathname)) {
    return;
  }

  injectGridVideoButtons(context);
}

type HandlePageChangeParams = {
  url: string;
  context: InstanceType<typeof ContentScriptContext>;
};
export function handlePageChange({ url, context }: HandlePageChangeParams) {
  const { pathname } = new URL(url);

  cleanupPanelUi();
  cleanupPlaylistUi();
  cleanupGridUi();

  setNativeDownloadVisibility(CONTENT_OPTIONS.isShowNativeDownload);

  if (pathname === PLAYLIST_PATHNAME) {
    injectPlaylistDownloaderUi(context).catch(() => {});
    handlePlaylistVideoAdditions(context);
    return;
  }

  syncGridDownloadButtons({
    pathname,
    context
  });
}

import { cleanupGridUi, injectGridVideoButtons } from "./grid-ui";
import { cleanupPanelUi } from "./panel-ui";
import { cleanupPlaylistUi, handlePlaylistVideoAdditions, injectPlaylistDownloaderUi } from "./playlist-ui";
import { CONTENT_OPTIONS } from "@/lib/ui/synced-stores.svelte";
import { WATCH_PAGE_PATHNAME } from "@/lib/youtube/youtube-url";

const HIDE_NATIVE_DOWNLOAD_CLASS = "ytdl-hide-native-download";
const PLAYLIST_PATHNAME = "/playlist";

export function setNativeDownloadVisibility(isVisible: boolean) {
  document.documentElement.classList.toggle(HIDE_NATIVE_DOWNLOAD_CLASS, !isVisible);
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

  if (pathname === WATCH_PAGE_PATHNAME) {
    return;
  }

  if (pathname === PLAYLIST_PATHNAME) {
    injectPlaylistDownloaderUi(context).catch(() => {});
    handlePlaylistVideoAdditions(context);
    return;
  }

  injectGridVideoButtons(context);
}

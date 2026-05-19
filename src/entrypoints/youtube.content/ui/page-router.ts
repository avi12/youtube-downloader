import { cleanupGridUi, injectGridVideoButtons } from "./grid-ui";
import { cleanupPanelUi } from "./panel-ui";
import { cleanupPlaylistUi, handlePlaylistVideoAdditions, injectPlaylistDownloaderUi } from "./playlist-ui";
import { CONTENT_OPTIONS } from "@/lib/ui/synced-stores.svelte";

const HIDE_NATIVE_DOWNLOAD_CLASS = "ytdl-hide-native-download";
const WATCH_PATHNAME = "/watch";
const PLAYLIST_PATHNAME = "/playlist";

export function setNativeDownloadVisibility(isVisible: boolean) {
  document.documentElement.classList.toggle(HIDE_NATIVE_DOWNLOAD_CLASS, !isVisible);
}

export function handlePageChange({ url, context }: {
  url: string;
  context: InstanceType<typeof ContentScriptContext>;
}) {
  const { pathname } = new URL(url);

  cleanupPanelUi();
  cleanupPlaylistUi();
  cleanupGridUi();

  setNativeDownloadVisibility(CONTENT_OPTIONS.isShowNativeDownload);

  if (pathname === WATCH_PATHNAME) {
    return;
  }

  if (pathname === PLAYLIST_PATHNAME) {
    void injectPlaylistDownloaderUi(context);
    handlePlaylistVideoAdditions(context);
    return;
  }

  injectGridVideoButtons(context);
}

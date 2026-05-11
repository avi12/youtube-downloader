import { cleanupGridUi, injectGridVideoButtons } from "./grid-ui";
import { cleanupPanelUi } from "./panel-ui";
import { cleanupPlaylistUi, handlePlaylistVideoAdditions, injectPlaylistDownloaderUi } from "./playlist-ui";
import { CONTENT_OPTIONS } from "@/lib/ui/synced-stores.svelte";

const HIDE_NATIVE_DOWNLOAD_CLASS = "ytdl-hide-native-download";

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

  if (pathname === "/watch") {
    setNativeDownloadVisibility(CONTENT_OPTIONS.value.isShowNativeDownload);
    return;
  }

  setNativeDownloadVisibility(CONTENT_OPTIONS.value.isShowNativeDownload);

  if (pathname === "/playlist") {
    void injectPlaylistDownloaderUi(context);
    handlePlaylistVideoAdditions(context);
    return;
  }

  injectGridVideoButtons(context);
}

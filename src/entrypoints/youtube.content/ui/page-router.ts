import { cleanupGridUi, injectGridVideoButtons } from "./grid-ui";
import { cleanupPanelUi } from "./panel-ui";
import { cleanupPlaylistUi, handlePlaylistVideoAdditions, injectPlaylistDownloaderUi } from "./playlist-ui";
import { contentOptions } from "@/lib/ui/synced-stores.svelte";
import { YouTubePath } from "@/lib/youtube/youtube-url";

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

  if (pathname === YouTubePath.Watch) {
    setNativeDownloadVisibility(contentOptions.value.isShowNativeDownload);
    return;
  }

  setNativeDownloadVisibility(contentOptions.value.isShowNativeDownload);

  if (pathname === YouTubePath.Playlist) {
    void injectPlaylistDownloaderUi(context);
    handlePlaylistVideoAdditions(context);
    return;
  }

  injectGridVideoButtons(context);
}

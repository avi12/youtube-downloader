import { cleanupGridUi, injectGridVideoButtons } from "./grid-ui";
import { cleanupPanelUi } from "./panel-ui";
import { cleanupPlaylistUi, handlePlaylistVideoAdditions, injectPlaylistDownloaderUi } from "./playlist-ui";
import { contentOptions } from "@/lib/ui/synced-stores.svelte";

const NATIVE_DOWNLOAD_SELECTOR = "ytd-download-button-renderer";

export function setNativeDownloadVisibility(isVisible: boolean) {
  for (const elButton of document.querySelectorAll<HTMLElement>(NATIVE_DOWNLOAD_SELECTOR)) {
    elButton.style.display = isVisible ? "" : "none";
  }
}

export function handlePageChange(
  url: string,
  context: InstanceType<typeof ContentScriptContext>
) {
  const { pathname } = new URL(url);

  cleanupPanelUi();
  cleanupPlaylistUi();
  cleanupGridUi();

  if (pathname === "/watch") {
    setNativeDownloadVisibility(!contentOptions.value.isRemoveNativeDownload);
    return;
  }

  setNativeDownloadVisibility(true);

  if (pathname === "/playlist") {
    void injectPlaylistDownloaderUi(context);
    handlePlaylistVideoAdditions(context);
    return;
  }

  injectGridVideoButtons(context);
}

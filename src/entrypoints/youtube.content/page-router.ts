import { cleanupGridUi, injectGridVideoButtons, isVideoGridPage } from "./grid-ui";
import { cleanupPanelUi } from "./panel-ui";
import { cleanupPlaylistUi, handlePlaylistVideoAdditions, injectPlaylistDownloaderUi } from "./playlist-ui";
import type { Options } from "@/types";

const NATIVE_DOWNLOAD_SELECTOR = "ytd-download-button-renderer";

export function setNativeDownloadVisibility(isVisible: boolean) {
  for (const elButton of document.querySelectorAll<HTMLElement>(NATIVE_DOWNLOAD_SELECTOR)) {
    elButton.style.display = isVisible ? "" : "none";
  }
}

export function handlePageChange(
  url: string,
  context: InstanceType<typeof ContentScriptContext>,
  options: Options
) {
  const { pathname } = new URL(url);
  if (pathname === "/watch") {
    cleanupPlaylistUi();
    cleanupGridUi();
    cleanupPanelUi();
    setNativeDownloadVisibility(!options.isRemoveNativeDownload);
    return;
  }

  if (pathname === "/playlist") {
    cleanupPanelUi();
    cleanupGridUi();
    setNativeDownloadVisibility(true);
    injectPlaylistDownloaderUi(context, options);
    handlePlaylistVideoAdditions(context, options);
    return;
  }

  if (isVideoGridPage(pathname)) {
    cleanupPanelUi();
    cleanupPlaylistUi();
    cleanupGridUi();
    setNativeDownloadVisibility(true);
    injectGridVideoButtons(context, options);
    return;
  }

  cleanupPanelUi();
  cleanupPlaylistUi();
  cleanupGridUi();
  setNativeDownloadVisibility(true);
}

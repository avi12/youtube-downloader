import { cleanupGridUi, injectGridVideoButtons } from "./grid-ui";
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

  cleanupPanelUi();
  cleanupPlaylistUi();
  cleanupGridUi();

  if (pathname === "/watch") {
    setNativeDownloadVisibility(!options.isRemoveNativeDownload);
    return;
  }

  setNativeDownloadVisibility(true);

  if (pathname === "/playlist") {
    void injectPlaylistDownloaderUi(context, options);
    handlePlaylistVideoAdditions(context, options);
    return;
  }

  injectGridVideoButtons(context, options);
}

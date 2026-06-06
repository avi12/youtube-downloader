import downloadStateStyles from "@/components/download-button/download-button-state.css?inline";

const STYLE_ELEMENT_ID = "ytdl-download-state-styles";

// The grid/playlist download buttons are mounted into the page light DOM via
// createIntegratedUi, so the content-script stylesheet does not reach them.
// Inject the shared state styling into document.head the same way the watch
// button does, so completed downloads get the green background everywhere.
export function injectDownloadStateStyles() {
  if (document.getElementById(STYLE_ELEMENT_ID)) {
    return;
  }

  const elStyle = document.createElement("style");
  elStyle.id = STYLE_ELEMENT_ID;
  elStyle.textContent = downloadStateStyles;
  document.head.append(elStyle);
}

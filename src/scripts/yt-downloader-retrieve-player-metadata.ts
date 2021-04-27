export function getElement(selector: string): HTMLElement {
  const elements = document.querySelectorAll(
    selector
  ) as NodeListOf<HTMLElement>;
  return [...elements].find(
    element => element.offsetWidth && element.offsetHeight
  );
}

function showContextMenuDialog() {
  const elPlayer = getElement(".html5-video-player");
  elPlayer.dispatchEvent(new Event("contextmenu"));
}

function openStats() {
  const elOptionStats = document.querySelector(
    ".ytp-contextmenu .ytp-panel-menu"
  ).lastElementChild as HTMLDivElement;

  elOptionStats.click();
}

function getCurrentQuality() {
  const elMetadata = document.querySelector(".html5-video-info-panel-content");
  const elQualityRow = [...elMetadata.children].find(elStat =>
    elStat.textContent.includes("@")
  );

  const qualityFps = elQualityRow.lastElementChild.textContent.split("/")[0];
  const resolution = qualityFps.split("@")[0];
  return Math.min(...resolution.split("x").map(Number));
}

function closeStats() {
  const elButtonClose = document.querySelector(
    "button.html5-video-info-panel-close"
  ) as HTMLDivElement;
  elButtonClose.click();
}

export function getQuality() {
  showContextMenuDialog();
  openStats();

  const qualityCurrent = getCurrentQuality();

  closeStats();
  if (qualityCurrent === 0) {
    return getQuality();
  }
  return qualityCurrent;
}

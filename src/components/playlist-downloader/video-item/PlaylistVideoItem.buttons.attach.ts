export function attachDownloadButton(
  elButton: Element,
  onClickDownload: () => void,
  refreshDownload: () => void,
  setDownloadButtonElement: (el: Element) => void
) {
  if (!(elButton instanceof HTMLElement)) {
    return;
  }

  setDownloadButtonElement(elButton);
  elButton.addEventListener("click", onClickDownload);
  refreshDownload();
  return () => elButton.removeEventListener("click", onClickDownload);
}

export function attachChevronButton(
  elButton: Element,
  onClickChevron: () => void,
  refreshChevron: () => void,
  setChevronButtonElement: (el: Element) => void
) {
  if (!(elButton instanceof HTMLElement)) {
    return;
  }

  setChevronButtonElement(elButton);
  elButton.addEventListener("click", onClickChevron);
  refreshChevron();
  elButton.setAttribute("style", "margin-left: 0 !important");
  return () => elButton.removeEventListener("click", onClickChevron);
}

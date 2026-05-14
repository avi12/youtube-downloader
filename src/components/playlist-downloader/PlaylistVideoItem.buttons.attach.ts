export function attachDownloadButton(
  elButton: Element,
  onClickDownload: () => void,
  refreshDownload: () => void,
  setElDownloadBtn: (el: Element) => void
) {
  if (!(elButton instanceof HTMLElement)) {
    return;
  }

  setElDownloadBtn(elButton);
  elButton.addEventListener("click", onClickDownload);
  refreshDownload();
  return () => elButton.removeEventListener("click", onClickDownload);
}

export function attachChevronButton(
  elButton: Element,
  onClickChevron: () => void,
  refreshChevron: () => void,
  setElChevronBtn: (el: Element) => void
) {
  if (!(elButton instanceof HTMLElement)) {
    return;
  }

  setElChevronBtn(elButton);
  elButton.addEventListener("click", onClickChevron);
  refreshChevron();
  elButton.setAttribute("style", "margin-left: 0 !important");
  return () => elButton.removeEventListener("click", onClickChevron);
}

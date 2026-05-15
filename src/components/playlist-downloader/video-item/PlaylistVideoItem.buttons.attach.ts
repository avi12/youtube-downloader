export function attachDownloadButton({
  elButton,
  onClickDownload,
  refreshDownload,
  setDownloadButtonElement
}: {
  elButton: Element;
  onClickDownload: () => void;
  refreshDownload: () => void;
  setDownloadButtonElement: (el: Element) => void;
}) {
  const isNotHtmlElement = !(elButton instanceof HTMLElement);
  if (isNotHtmlElement) {
    return;
  }

  setDownloadButtonElement(elButton);
  elButton.addEventListener("click", onClickDownload);
  refreshDownload();
  return () => elButton.removeEventListener("click", onClickDownload);
}

export function attachChevronButton({
  elButton,
  onClickChevron,
  refreshChevron,
  setChevronButtonElement
}: {
  elButton: Element;
  onClickChevron: () => void;
  refreshChevron: () => void;
  setChevronButtonElement: (el: Element) => void;
}) {
  const isNotHtmlElement = !(elButton instanceof HTMLElement);
  if (isNotHtmlElement) {
    return;
  }

  setChevronButtonElement(elButton);
  elButton.addEventListener("click", onClickChevron);
  refreshChevron();
  elButton.setAttribute("style", "margin-left: 0 !important");
  return () => elButton.removeEventListener("click", onClickChevron);
}

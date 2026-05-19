const CHEVRON_MARGIN_OVERRIDE_STYLE = "margin-left: 0 !important";

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
  const isHtmlElement = elButton instanceof HTMLElement;
  if (!isHtmlElement) {
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
  const isHtmlElement = elButton instanceof HTMLElement;
  if (!isHtmlElement) {
    return;
  }

  setChevronButtonElement(elButton);
  elButton.addEventListener("click", onClickChevron);
  refreshChevron();
  elButton.setAttribute("style", CHEVRON_MARGIN_OVERRIDE_STYLE);
  return () => elButton.removeEventListener("click", onClickChevron);
}

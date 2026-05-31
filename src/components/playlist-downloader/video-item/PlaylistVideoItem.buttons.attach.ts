import { onButtonClick } from "@/lib/messaging/cross-world-messenger";

const CHEVRON_MARGIN_OVERRIDE_STYLE = "margin-left: 0 !important";

export function attachDownloadButton({
  elButton,
  buttonId,
  onClickDownload,
  refreshDownload,
  setDownloadButtonElement
}: {
  elButton: Element;
  buttonId: string;
  onClickDownload: () => void;
  refreshDownload: () => void;
  setDownloadButtonElement: (element: Element) => void;
}) {
  const isHtmlElement = elButton instanceof HTMLElement;
  if (!isHtmlElement) {
    return;
  }

  setDownloadButtonElement(elButton);
  const unsubscribe = onButtonClick(clickedId => {
    if (clickedId === buttonId) {
      onClickDownload();
    }
  });
  refreshDownload();
  return unsubscribe;
}

export function attachChevronButton({
  elButton,
  buttonId,
  onClickChevron,
  refreshChevron,
  setChevronButtonElement
}: {
  elButton: Element;
  buttonId: string;
  onClickChevron: () => void;
  refreshChevron: () => void;
  setChevronButtonElement: (element: Element) => void;
}) {
  const isHtmlElement = elButton instanceof HTMLElement;
  if (!isHtmlElement) {
    return;
  }

  setChevronButtonElement(elButton);
  const unsubscribe = onButtonClick(clickedId => {
    if (clickedId === buttonId) {
      onClickChevron();
    }
  });
  refreshChevron();
  elButton.setAttribute("style", CHEVRON_MARGIN_OVERRIDE_STYLE);
  return unsubscribe;
}

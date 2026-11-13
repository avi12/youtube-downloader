import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import type { TpYtIronDropdownElement, YtButtonViewModelElement } from "@/types";
import type { buildChevronData, buildDownloadData } from "./watch-button-view-model";

const SEGMENTED_START_CLASS = "ytSpecButtonShapeNextSegmentedStart";
const SEGMENTED_END_CLASS = "ytSpecButtonShapeNextSegmentedEnd";

export function createButtonElementEffects({
  getElDownloadButton,
  getElChevronButton,
  getDownloadData,
  getChevronData,
  getElDropdown,
  isSegmented
}: {
  getElDownloadButton: () => YtButtonViewModelElement | null;
  getElChevronButton: () => YtButtonViewModelElement | null;
  getDownloadData: () => ReturnType<typeof buildDownloadData>;
  getChevronData: () => ReturnType<typeof buildChevronData>;
  getElDropdown: () => TpYtIronDropdownElement;
  isSegmented: boolean;
}) {
  function applySegmentedClasses() {
    if (!isSegmented) {
      return;
    }

    getElDownloadButton()
      ?.querySelector<HTMLButtonElement>("button")
      ?.classList.add(SEGMENTED_START_CLASS);
    getElChevronButton()
      ?.querySelector<HTMLButtonElement>("button")
      ?.classList.add(SEGMENTED_END_CLASS);
  }

  $effect(() => {
    const elDownloadButton = getElDownloadButton();
    if (!elDownloadButton) {
      return;
    }

    elDownloadButton.data = getDownloadData();
    requestAnimationFrame(applySegmentedClasses);
  });

  $effect(() => {
    const elChevronButton = getElChevronButton();
    if (!elChevronButton) {
      return;
    }

    elChevronButton.data = getChevronData();
    requestAnimationFrame(applySegmentedClasses);
  });

  $effect(() => {
    const elDownloadButton = getElDownloadButton();
    const elChevronButton = getElChevronButton();
    const isEveryButtonMissing = !elDownloadButton || !elChevronButton;
    if (isEveryButtonMissing) {
      return;
    }

    const observer = new MutationObserver(() => requestAnimationFrame(applySegmentedClasses));
    observer.observe(elDownloadButton, CHILD_LIST_SUBTREE);
    observer.observe(elChevronButton, CHILD_LIST_SUBTREE);
    requestAnimationFrame(applySegmentedClasses);
    return () => observer.disconnect();
  });

  $effect(() => {
    const elChevronButton = getElChevronButton();
    if (!elChevronButton) {
      return;
    }

    getElDropdown().positionTarget = elChevronButton;
  });
}

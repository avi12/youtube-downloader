import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import type { YtButtonViewModelElement } from "@/types";

export function createButtonElementEffects(
  getElDownloadButton: () => YtButtonViewModelElement | null,
  getElChevronButton: () => YtButtonViewModelElement | null,
  getDownloadData: () => ReturnType<typeof import("./watch-button-view-model").buildDownloadData>,
  getChevronData: () => ReturnType<typeof import("./watch-button-view-model").buildChevronData>,
  getElDropdown: () => import("@/types").TpYtIronDropdownElement
) {
  function applySegmentedClasses() {
    getElDownloadButton()
      ?.querySelector<HTMLButtonElement>("button")
      ?.classList.add("ytSpecButtonShapeNextSegmentedStart");
    getElChevronButton()
      ?.querySelector<HTMLButtonElement>("button")
      ?.classList.add("ytSpecButtonShapeNextSegmentedEnd");
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
    if (!elDownloadButton || !elChevronButton) {
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

import {
  mountPanelInContent,
  registerDropdownCloseListeners,
  requestDropdownCreation
} from "../helpers/playlist-dropdown-lifecycle";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import type { VideoData } from "@/types";
import { mount, unmount } from "svelte";

const PANEL_ABOVE_OVERLAP_PX = 4;
const IRON_OVERLAY_OPENED_EVENT = "iron-overlay-opened";

export function createPanelManager({
  videoId,
  getVideoData,
  getElChevronButton,
  getElButtonGroup,
  onChevronRefresh
}: {
  videoId: string;
  getVideoData: () => VideoData | null;
  getElChevronButton: () => Element | null;
  getElButtonGroup: () => HTMLElement | null;
  onChevronRefresh: () => void;
}) {
  let isOpen = $state(false);
  let isPanelBelow = $state(true);
  let elDropdown = $state<HTMLElement | null>(null);
  let panelInstance: ReturnType<typeof mount> | null = null;
  let unsubscribeDropdownReady: (() => void) | null = null;

  function predictPanelBelow() {
    const elChevron = getElChevronButton();
    if (!elChevron) {
      return true;
    }

    const chevronRect = elChevron.getBoundingClientRect();
    const spaceAbove = chevronRect.top;
    const spaceBelow = innerHeight - chevronRect.bottom;
    return spaceBelow >= spaceAbove;
  }

  function reconcilePanelPosition() {
    const elChevron = getElChevronButton();
    if (!elDropdown || !elChevron) {
      return;
    }

    const dropdownRect = elDropdown.getBoundingClientRect();
    const isDropdownEmpty = dropdownRect.width === 0 && dropdownRect.height === 0;
    if (isDropdownEmpty) {
      return;
    }

    const isAbove = dropdownRect.bottom <= elChevron.getBoundingClientRect().top + PANEL_ABOVE_OVERLAP_PX;
    isPanelBelow = !isAbove;
    onChevronRefresh();
  }

  function open() {
    const videoData = getVideoData();
    const elButtonGroup = getElButtonGroup();
    const isMissingRequirements = !videoData || !elButtonGroup || elDropdown;
    if (isMissingRequirements) {
      return;
    }

    const panelContentId = requestDropdownCreation(videoId);

    unsubscribeDropdownReady = crossWorldMessenger.onMessage(CrossWorldMessage.DropdownReady, ({ data }) => {
      const isThisPanel = data.contentId === panelContentId;
      if (!isThisPanel) {
        return;
      }

      unsubscribeDropdownReady?.();
      unsubscribeDropdownReady = null;

      if (panelInstance) {
        return;
      }

      const mounted = mountPanelInContent({
        contentId: panelContentId,
        videoData
      });
      if (!mounted) {
        return;
      }

      elDropdown = mounted.elDropdown;
      panelInstance = mounted.panelInstance;

      elDropdown?.addEventListener(IRON_OVERLAY_OPENED_EVENT, () => {
        requestAnimationFrame(reconcilePanelPosition);
      }, { once: true });
      addEventListener("resize", reconcilePanelPosition);

      registerDropdownCloseListeners({
        elDropdown,
        onClose() {
          if (isOpen) {
            isOpen = false;
            close();
          }
        }
      });
    });
  }

  function close() {
    removeEventListener("resize", reconcilePanelPosition);

    if (unsubscribeDropdownReady) {
      unsubscribeDropdownReady();
      unsubscribeDropdownReady = null;
    }

    if (panelInstance) {
      void unmount(panelInstance);
      panelInstance = null;
    }

    if (elDropdown) {
      void crossWorldMessenger.sendMessage(CrossWorldMessage.CloseDropdown, { videoId });
      elDropdown = null;
    }
  }

  function toggle() {
    isOpen = !isOpen;

    if (isOpen) {
      isPanelBelow = predictPanelBelow();
      open();
    } else {
      close();
    }
  }

  return {
    get isOpen() {
      return isOpen;
    },
    get isPanelBelow() {
      return isPanelBelow;
    },
    get elDropdown() {
      return elDropdown;
    },
    toggle
  };
}

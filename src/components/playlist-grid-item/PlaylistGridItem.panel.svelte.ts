import {
  mountPlaylistPanelInContent,
  registerPlaylistDropdownCloseListeners,
  requestPlaylistDropdownCreation
} from "./helpers/playlist-grid-panel-lifecycle";
import type { createPlaylistGridItemState } from "./PlaylistGridItem.state.svelte";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { mount, unmount } from "svelte";

const PANEL_ABOVE_OVERLAP_PX = 4;
const IRON_OVERLAY_OPENED_EVENT = "iron-overlay-opened";

type CreatePanelManagerParams = {
  playlistId: string;
  state: ReturnType<typeof createPlaylistGridItemState>;
  getElChevronButton: () => Element | null;
  onChevronRefresh: () => void;
};
export function createPanelManager({
  playlistId,
  state,
  getElChevronButton,
  onChevronRefresh
}: CreatePanelManagerParams) {
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
    if (elDropdown) {
      return;
    }

    const panelContentId = requestPlaylistDropdownCreation(playlistId);

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

      const mounted = mountPlaylistPanelInContent({
        contentId: panelContentId,
        playlistId,
        state
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

      registerPlaylistDropdownCloseListeners({
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
      void crossWorldMessenger.sendMessage(CrossWorldMessage.CloseDropdown, { videoId: playlistId });
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
    toggle
  };
}

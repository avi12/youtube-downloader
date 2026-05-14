import {
  mountPanelInContent,
  registerDropdownCloseListeners,
  requestDropdownCreation
} from "../helpers/playlist-dropdown-lifecycle";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import type { VideoData } from "@/types";
import { mount, unmount } from "svelte";

export function createPanelManager(
  videoId: string,
  getVideoData: () => VideoData | null,
  getElButtonGroup: () => HTMLElement | null,
  onChevronRefresh: () => void
) {
  let isOpen = $state(false);
  let elDropdown = $state<HTMLElement | null>(null);
  let panelInstance: ReturnType<typeof mount> | null = null;
  let unsubscribeDropdownReady: (() => void) | null = null;

  function open() {
    const videoData = getVideoData();
    const elButtonGroup = getElButtonGroup();
    if (!videoData || !elButtonGroup || elDropdown) {
      return;
    }

    const panelContentId = requestDropdownCreation(videoId);

    unsubscribeDropdownReady = crossWorldMessenger.onMessage(CrossWorldMessage.DropdownReady, ({ data }) => {
      if (data.contentId !== panelContentId) {
        return;
      }

      unsubscribeDropdownReady?.();
      unsubscribeDropdownReady = null;

      if (panelInstance) {
        return;
      }

      const mounted = mountPanelInContent(panelContentId, videoData);
      if (!mounted) {
        return;
      }

      elDropdown = mounted.elDropdown;
      panelInstance = mounted.panelInstance;

      elDropdown?.addEventListener("iron-overlay-opened", () => onChevronRefresh(), { once: true });
      addEventListener("resize", onChevronRefresh);

      registerDropdownCloseListeners(elDropdown, () => {
        if (isOpen) {
          isOpen = false;
          close();
        }
      });
    });
  }

  function close() {
    removeEventListener("resize", onChevronRefresh);

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
      open();
    } else {
      close();
    }
  }

  return {
    get isOpen() {
      return isOpen;
    },
    get elDropdown() {
      return elDropdown;
    },
    toggle
  };
}

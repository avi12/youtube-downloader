import DownloadOptionsPanel from "./DownloadOptionsPanel.svelte";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/cross-world-messenger";
import type { Options, VideoData } from "@/types";
import { mount, unmount } from "svelte";

export function createPanelManager(
  videoId: string,
  getVideoData: () => VideoData | null,
  getOptions: () => Options,
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

    const panelContentId = `ytdl-grid-panel-${videoId}`;
    // Grid cards mark themselves with data-ytdl-grid-item, playlist rows with
    // data-ytdl-item. Match either so iron-dropdown can anchor on both pages.
    const positionTargetSelector = `[data-ytdl-grid-item="${videoId}"] .ytdl-button-group, [data-ytdl-item="${videoId}"] .ytdl-button-group`;

    void crossWorldMessenger.sendMessage(CrossWorldMessage.CreateDropdown, {
      contentId: panelContentId,
      positionTargetSelector
    });

    unsubscribeDropdownReady = crossWorldMessenger.onMessage(CrossWorldMessage.DropdownReady, ({ data }) => {
      if (data.contentId !== panelContentId) {
        return;
      }

      unsubscribeDropdownReady?.();
      unsubscribeDropdownReady = null;

      if (panelInstance) {
        return;
      }

      const elContent = document.getElementById(panelContentId);
      if (!elContent) {
        return;
      }

      elDropdown = elContent.closest("tp-yt-iron-dropdown");

      // Polymer elements need the MAIN world's Polymer runtime to function,
      // so create the dropdown via the MAIN world bridge.
      panelInstance = mount(DownloadOptionsPanel, {
        target: elContent,
        props: { videoData, options: getOptions() }
      });

      // iron-dropdown only finishes positioning on iron-overlay-opened — that's
      // when the anchor-relative above/below decision is final, so refresh the
      // chevron direction from there.
      elDropdown?.addEventListener("iron-overlay-opened", () => onChevronRefresh(), { once: true });

      // Window resize can flip iron-dropdown from below to above or vice versa
      // (it calls its own refit), so keep the chevron in sync until the panel closes.
      addEventListener("resize", onChevronRefresh);

      function handleOverlayClose() {
        if (isOpen) {
          isOpen = false;
          close();
        }

        elDropdown?.removeEventListener("iron-overlay-closed", handleOverlayClose);
        document.removeEventListener("ytdl:panel-closed", handleOverlayClose);
      }

      elDropdown?.addEventListener("iron-overlay-closed", handleOverlayClose);
      document.addEventListener("ytdl:panel-closed", handleOverlayClose);
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

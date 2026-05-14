import DownloadOptionsPanel from "../download-options-panel/DownloadOptionsPanel.svelte";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import type { VideoData } from "@/types";
import { mount } from "svelte";

export function buildPanelContentId(videoId: string) {
  return `ytdl-grid-panel-${videoId}`;
}

function buildPositionTargetSelector(videoId: string) {
  return `[data-ytdl-grid-item="${videoId}"] .ytdl-button-group, [data-ytdl-item="${videoId}"] .ytdl-button-group`;
}

export function requestDropdownCreation(videoId: string) {
  const panelContentId = buildPanelContentId(videoId);
  void crossWorldMessenger.sendMessage(CrossWorldMessage.CreateDropdown, {
    contentId: panelContentId,
    positionTargetSelector: buildPositionTargetSelector(videoId)
  });
  return panelContentId;
}

export function mountPanelInContent(contentId: string, videoData: VideoData) {
  const elContent = document.getElementById(contentId);
  if (!elContent) {
    return null;
  }

  const elDropdownEl = elContent.closest("tp-yt-iron-dropdown");
  const elDropdown = elDropdownEl instanceof HTMLElement ? elDropdownEl : null;
  const panelInstance = mount(DownloadOptionsPanel, {
    target: elContent,
    props: {
      videoData
    }
  });

  return {
    elDropdown,
    panelInstance
  };
}

export function registerDropdownCloseListeners(
  elDropdown: HTMLElement | null,
  onClose: () => void
) {
  function handleOverlayClose() {
    onClose();
    elDropdown?.removeEventListener("iron-overlay-closed", handleOverlayClose);
    document.removeEventListener("ytdl:panel-closed", handleOverlayClose);
  }

  elDropdown?.addEventListener("iron-overlay-closed", handleOverlayClose);
  document.addEventListener("ytdl:panel-closed", handleOverlayClose);
}

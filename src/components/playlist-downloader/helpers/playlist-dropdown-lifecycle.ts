import { PANEL_CLOSED_EVENT } from "../../download-options-panel/DownloadOptionsPanel.handlers.ts";
import DownloadOptionsPanel from "../../download-options-panel/DownloadOptionsPanel.svelte";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import type { Prettify, VideoData } from "@/types";
import { mount } from "svelte";

const IRON_OVERLAY_CLOSED_EVENT = "iron-overlay-closed";
const POLYMER_IRON_DROPDOWN = "tp-yt-iron-dropdown";
const GRID_PANEL_ID_PREFIX = "ytdl-grid-panel-";
const CHEVRON_BUTTON_ID_PREFIX = "btn-";
const CHEVRON_BUTTON_ID_SUFFIX = "-chevron";
const BUTTON_ID_ATTR = "data-ytdl-button-id";

export function buildPanelContentId(videoId: string) {
  return `${GRID_PANEL_ID_PREFIX}${videoId}`;
}

function buildPositionTargetSelector(videoId: string) {
  return `[${BUTTON_ID_ATTR}="${CHEVRON_BUTTON_ID_PREFIX}${videoId}${CHEVRON_BUTTON_ID_SUFFIX}"]`;
}

export function requestDropdownCreation(videoId: string) {
  const panelContentId = buildPanelContentId(videoId);
  void crossWorldMessenger.sendMessage(CrossWorldMessage.CreateDropdown, {
    contentId: panelContentId,
    positionTargetSelector: buildPositionTargetSelector(videoId)
  });
  return panelContentId;
}

type MountPanelInContentParams = Prettify<{
  contentId: string;
  videoData: VideoData;
}>;
export function mountPanelInContent({ contentId, videoData }: MountPanelInContentParams) {
  const elContent = document.getElementById(contentId);
  if (!elContent) {
    return null;
  }

  const elDropdownCandidate = elContent.closest(POLYMER_IRON_DROPDOWN);
  const elDropdown = elDropdownCandidate instanceof HTMLElement ? elDropdownCandidate : null;
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

type RegisterDropdownCloseListenersParams = Prettify<{
  elDropdown: HTMLElement | null;
  onClose: () => void;
}>;
export function registerDropdownCloseListeners({
  elDropdown,
  onClose
}: RegisterDropdownCloseListenersParams) {
  function handleOverlayClose() {
    onClose();
    elDropdown?.removeEventListener(IRON_OVERLAY_CLOSED_EVENT, handleOverlayClose);
    document.removeEventListener(PANEL_CLOSED_EVENT, handleOverlayClose);
  }

  elDropdown?.addEventListener(IRON_OVERLAY_CLOSED_EVENT, handleOverlayClose);
  document.addEventListener(PANEL_CLOSED_EVENT, handleOverlayClose);
}

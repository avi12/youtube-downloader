import type { createPlaylistGridItemState } from "../PlaylistGridItem.state.svelte";
import PlaylistGridPanel from "../PlaylistGridPanel.svelte";
import { PANEL_CLOSED_EVENT } from "@/components/download-options-panel/DownloadOptionsPanel.handlers.ts";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import type { Prettify } from "@/types";
import { mount } from "svelte";

const IRON_OVERLAY_CLOSED_EVENT = "iron-overlay-closed";
const POLYMER_IRON_DROPDOWN = "tp-yt-iron-dropdown";
const GRID_PANEL_ID_PREFIX = "ytdl-grid-panel-playlist-";
const CHEVRON_BUTTON_ID_PREFIX = "btn-playlist-";
const CHEVRON_BUTTON_ID_SUFFIX = "-chevron";
const BUTTON_ID_ATTR = "data-ytdl-button-id";

export function buildPlaylistPanelContentId(playlistId: string) {
  return `${GRID_PANEL_ID_PREFIX}${playlistId}`;
}

export function buildPlaylistChevronButtonId(playlistId: string) {
  return `${CHEVRON_BUTTON_ID_PREFIX}${playlistId}${CHEVRON_BUTTON_ID_SUFFIX}`;
}

export function buildPlaylistDownloadButtonId(playlistId: string) {
  return `btn-playlist-${playlistId}-download`;
}

function buildPositionTargetSelector(playlistId: string) {
  return `[${BUTTON_ID_ATTR}="${buildPlaylistChevronButtonId(playlistId)}"]`;
}

export function requestPlaylistDropdownCreation(playlistId: string) {
  const panelContentId = buildPlaylistPanelContentId(playlistId);
  void crossWorldMessenger.sendMessage(CrossWorldMessage.CreateDropdown, {
    contentId: panelContentId,
    positionTargetSelector: buildPositionTargetSelector(playlistId)
  });
  return panelContentId;
}

type MountPlaylistPanelParams = Prettify<{
  contentId: string;
  playlistId: string;
  state: ReturnType<typeof createPlaylistGridItemState>;
}>;
export function mountPlaylistPanelInContent({ contentId, playlistId, state }: MountPlaylistPanelParams) {
  const elContent = document.getElementById(contentId);
  if (!elContent) {
    return null;
  }

  const elDropdownCandidate = elContent.closest(POLYMER_IRON_DROPDOWN);
  const elDropdown = elDropdownCandidate instanceof HTMLElement ? elDropdownCandidate : null;
  const panelInstance = mount(PlaylistGridPanel, {
    target: elContent,
    props: {
      playlistId,
      state
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
export function registerPlaylistDropdownCloseListeners({
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

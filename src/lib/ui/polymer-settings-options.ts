import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import type { YtdSettingsOptionsElement } from "@/types/polymer-elements";

export const DATA_SETTINGS_OPTIONS_ID_ATTR = "data-ytdl-settings-id";
let settingsOptionsIdCounter = 0;

export function isYtdSettingsOptionsRenderer(elTarget: Element): elTarget is YtdSettingsOptionsElement {
  return elTarget.tagName.toLowerCase() === "ytd-settings-options-renderer";
}

function sendSettingsOptionsData({ elTarget, title }: {
  elTarget: Element;
  title: string;
}) {
  const settingsId = elTarget.getAttribute(DATA_SETTINGS_OPTIONS_ID_ATTR);
  crossWorldMessenger.sendMessage(CrossWorldMessage.SetSettingsOptionsData, {
    selector: `[${DATA_SETTINGS_OPTIONS_ID_ATTR}="${settingsId}"]`,
    title
  }).catch(() => {});
}

export function attachSettingsOptions(title: string) {
  return (elTarget: Element) => {
    elTarget.setAttribute(DATA_SETTINGS_OPTIONS_ID_ATTR, `ytdl-settings-${++settingsOptionsIdCounter}`);
    sendSettingsOptionsData({
      elTarget,
      title
    });
  };
}

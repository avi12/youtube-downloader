import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { z } from "@/lib/zod";
import { createGuard } from "@/lib/zod-guard";

export const DATA_SETTINGS_OPTIONS_ID_ATTR = "data-ytdl-settings-id";
let settingsOptionsIdCounter = 0;

export const isYtdSettingsOptionsRenderer = createGuard(
  z.looseObject({
    tagName: z.literal("YTD-SETTINGS-OPTIONS-RENDERER"),
    set: z.function({
      input: [z.string(), z.unknown()],
      output: z.void()
    })
  })
);

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

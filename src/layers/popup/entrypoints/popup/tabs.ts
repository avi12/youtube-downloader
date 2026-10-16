import downloadIcon from "./icons/download.svg?raw";
import settingsIcon from "./icons/settings.svg?raw";

export const PopupPanel = {
  Downloads: "downloads",
  Settings: "settings"
} as const;

export type PopupPanel = (typeof PopupPanel)[keyof typeof PopupPanel];

export const PANEL_LABELS = {
  [PopupPanel.Downloads]: "Downloads",
  [PopupPanel.Settings]: "Settings"
} as const satisfies Record<PopupPanel, string>;

export function buildTabs(totalActiveDownloads: number) {
  return [
    {
      id: PopupPanel.Downloads,
      label: PANEL_LABELS[PopupPanel.Downloads],
      badge: totalActiveDownloads,
      icon: downloadIcon
    },
    {
      id: PopupPanel.Settings,
      label: PANEL_LABELS[PopupPanel.Settings],
      icon: settingsIcon
    }
  ];
}

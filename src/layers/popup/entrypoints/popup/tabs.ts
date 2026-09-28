import downloadIcon from "./icons/download.svg?raw";
import settingsIcon from "./icons/settings.svg?raw";

export const PopupPanel = {
  Downloads: "downloads",
  Settings: "settings"
} as const;

export type PopupPanel = (typeof PopupPanel)[keyof typeof PopupPanel];

export function buildTabs(totalActiveDownloads: number) {
  return [
    {
      id: PopupPanel.Downloads,
      label: "Downloads",
      badge: totalActiveDownloads,
      icon: downloadIcon
    },
    {
      id: PopupPanel.Settings,
      label: "Settings",
      icon: settingsIcon
    }
  ];
}

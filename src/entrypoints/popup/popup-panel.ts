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
      badge: totalActiveDownloads
    },
    {
      id: PopupPanel.Settings,
      label: "Settings"
    }
  ];
}

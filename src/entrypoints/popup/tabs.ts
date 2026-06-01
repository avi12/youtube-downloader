export const PopupPanel = {
  Downloads: "downloads",
  Settings: "settings"
} as const;

export type PopupPanel = (typeof PopupPanel)[keyof typeof PopupPanel];

const DOWNLOAD_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/></svg>`;

const SETTINGS_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 13a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V20a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 18.35a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.65 14a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 8 1.7 1.7 0 0 0 4.3 6.13l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 3.65 1.7 1.7 0 0 0 10 2.09V2a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 3.65a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.35 9c.27.65.9 1.05 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"/></svg>`;

export function buildTabs(totalActiveDownloads: number) {
  return [
    {
      id: PopupPanel.Downloads,
      label: "Downloads",
      badge: totalActiveDownloads,
      icon: DOWNLOAD_ICON_SVG
    },
    {
      id: PopupPanel.Settings,
      label: "Settings",
      icon: SETTINGS_ICON_SVG
    }
  ];
}

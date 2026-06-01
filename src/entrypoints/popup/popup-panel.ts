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
      icon: "M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"
    },
    {
      id: PopupPanel.Settings,
      label: "Settings",
      icon: "m388-80-20-126q-19-7-40-19t-37-25l-118 54-93-164 108-79q-2-9-2.5-20.5T185-480q0-9 .5-20.5T188-521L80-600l93-164 118 54q16-13 37-25t40-19l20-126h184l20 126q19 7 40 19t37 25l118-54 93 164-108 79q2 11 2.5 22.5T687-480q0 11-.5 22.5T684-436l108 79-93 164-118-54q-16 13-37 25t-40 19L572-80H388Zm92-270q54 0 92-38t38-92q0-54-38-92t-92-38q-54 0-92 38t-38 92q0 54 38 92t92 38Zm0-80q-21 0-35.5-14.5T430-480q0-21 14.5-35.5T480-530q21 0 35.5 14.5T530-480q0 21-14.5 35.5T480-350Zm0-130Z"
    }
  ];
}

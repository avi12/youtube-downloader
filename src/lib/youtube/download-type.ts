import { DownloadType, type DownloadTypePreference } from "@/types";

// "Auto" downloads music as audio and everything else as video + audio; any other setting is taken as-is
export function resolveDownloadType({ preference, isMusic }: {
  preference: DownloadTypePreference;
  isMusic: boolean;
}) {
  if (preference !== DownloadType.Auto) {
    return preference;
  }

  return isMusic ? DownloadType.Audio : DownloadType.VideoAndAudio;
}

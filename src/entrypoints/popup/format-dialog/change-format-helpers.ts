import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import {
  audioContainers,
  isCompatibleForRemux,
  splitFilenameAndExtension,
  videoContainers
} from "@/lib/utils/containers";
import type { RecentDownloadEntry } from "@/types";

const APPROX_SECONDS_PER_MB = 0.05;

export function buildEstimatedTimeLabel(sizeBytes: number) {
  const seconds = Math.max(1, Math.round((sizeBytes / (1024 * 1024)) * APPROX_SECONDS_PER_MB));
  return seconds < 60 ? `~${seconds}s` : `~${Math.round(seconds / 60)} min`;
}

export function buildAvailableTargets({ entry, isVideoContainer }: {
  entry: RecentDownloadEntry;
  isVideoContainer: boolean;
}) {
  return (isVideoContainer ? videoContainers : audioContainers)
    .filter(target => target !== entry.container)
    .filter(target => !isVideoContainer || !entry.videoMimeType || isCompatibleForRemux(entry.videoMimeType, entry.audioMimeType ?? "", target));
}

export async function submitTranscode({
  entry,
  selectedTarget,
  isSubmitting
}: {
  entry: RecentDownloadEntry;
  selectedTarget: string;
  isSubmitting: boolean;
}): Promise<boolean> {
  if (!selectedTarget || isSubmitting) {
    return false;
  }

  const filenameOutput = `${splitFilenameAndExtension(entry.filename).name}.${selectedTarget}`;
  await sendMessage(MessageType.TranscodeRecentDownload, {
    entryId: entry.id,
    targetContainer: selectedTarget,
    filenameOutput
  });
  return true;
}

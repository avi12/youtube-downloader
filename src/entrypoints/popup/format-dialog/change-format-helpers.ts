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

type BuildAvailableTargetsParams = {
  entry: RecentDownloadEntry;
  isVideoContainer: boolean;
};
export function buildAvailableTargets({ entry, isVideoContainer }: BuildAvailableTargetsParams) {
  return (isVideoContainer ? videoContainers : audioContainers)
    .filter(target => target !== entry.container)
    .filter(target => !isVideoContainer || !entry.videoMimeType || isCompatibleForRemux({
      videoMimeType: entry.videoMimeType,
      audioMimeType: entry.audioMimeType ?? "",
      targetExtension: target
    }));
}

type SubmitTranscodeParams = {
  entry: RecentDownloadEntry;
  selectedTarget: string;
  isSubmitting: boolean;
};
export async function submitTranscode({
  entry,
  selectedTarget,
  isSubmitting
}: SubmitTranscodeParams) {
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

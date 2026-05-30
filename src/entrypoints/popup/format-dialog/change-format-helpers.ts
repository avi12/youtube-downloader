import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import {
  audioContainers,
  buildFormatGroups,
  flattenFormatGroups,
  isCompatibleForRemux,
  splitFilenameAndExtension,
  videoContainers
} from "@/lib/utils/containers";
import type { FormatGroup } from "@/lib/utils/containers";
import type { RecentDownloadEntry } from "@/types";

const APPROX_SECONDS_PER_MB = 0.05;

export function buildEstimatedTimeLabel(sizeBytes: number) {
  const seconds = Math.max(1, Math.round((sizeBytes / (1024 * 1024)) * APPROX_SECONDS_PER_MB));
  return seconds < 60 ? `~${seconds}s` : `~${Math.round(seconds / 60)} min`;
}

export function isAudioSourceEntry(entry: RecentDownloadEntry) {
  return audioContainers.includes(entry.container) && !videoContainers.includes(entry.container);
}

type BuildAvailableTargetGroupsParams = {
  entry: RecentDownloadEntry;
};
export function buildAvailableTargetGroups({ entry }: BuildAvailableTargetGroupsParams): FormatGroup[] {
  const isAudioSource = isAudioSourceEntry(entry);
  // Audio sources can only re-target audio containers (no audio -> video).
  // Video sources can re-target video containers or extract to audio.
  const baseAllowed = isAudioSource ? audioContainers : [...videoContainers, ...audioContainers];

  const allowedExtensions = baseAllowed.filter(target => {
    if (target === entry.container) {
      return false;
    }

    const isVideoTarget = videoContainers.includes(target);
    const needsRemuxCheck = !isAudioSource && isVideoTarget && entry.videoMimeType;
    if (!needsRemuxCheck) {
      return true;
    }

    return isCompatibleForRemux({
      videoMimeType: entry.videoMimeType!,
      audioMimeType: entry.audioMimeType ?? "",
      targetExtension: target
    });
  });

  const groups = buildFormatGroups({ allowedExtensions });
  if (isAudioSource) {
    return groups;
  }

  return groups.map(group => group.heading === "Audio"
    ? {
      ...group,
      caption: "Extract audio as"
    }
    : group);
}

export function pickFirstSelectableTarget(groups: FormatGroup[]) {
  for (const group of groups) {
    const candidate = group.items.find(item => !item.isExcluded);
    if (candidate) {
      return candidate.extension;
    }
  }

  return "";
}

export function flattenTargets(groups: FormatGroup[]) {
  return flattenFormatGroups(groups).map(item => item.extension);
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
  const isNotReady = !selectedTarget || isSubmitting;
  if (isNotReady) {
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

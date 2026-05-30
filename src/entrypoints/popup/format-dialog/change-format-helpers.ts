import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import {
  audioContainers,
  buildFormatGroups,
  flattenFormatGroups,
  getVideoFallbackCodec,
  requiresVideoReencode,
  splitFilenameAndExtension,
  videoContainers
} from "@/lib/utils/containers";
import type { FormatGroup, FormatItem } from "@/lib/utils/containers";
import type { RecentDownloadEntry } from "@/types";

const APPROX_SECONDS_PER_MB_REMUX = 0.05;
const APPROX_SECONDS_PER_MB_REENCODE = 0.6;

type EstimatedTimeParams = {
  sizeBytes: number;
  isSlow?: boolean;
};
export function buildEstimatedTimeLabel({ sizeBytes, isSlow = false }: EstimatedTimeParams) {
  const secondsPerMb = isSlow ? APPROX_SECONDS_PER_MB_REENCODE : APPROX_SECONDS_PER_MB_REMUX;
  const seconds = Math.max(1, Math.round((sizeBytes / (1024 * 1024)) * secondsPerMb));
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
  const baseAllowed = isAudioSource ? audioContainers : [...videoContainers, ...audioContainers];

  const allowedExtensions = baseAllowed.filter(target => {
    if (target === entry.container) {
      return false;
    }

    const isVideoTarget = videoContainers.includes(target);
    const needsReencodeCheck = !isAudioSource && isVideoTarget && entry.videoMimeType;
    if (!needsReencodeCheck) {
      return true;
    }

    const wouldReencode = requiresVideoReencode({
      videoMimeType: entry.videoMimeType!,
      targetExtension: target
    });
    if (!wouldReencode) {
      return true;
    }

    // Re-encode is only possible when the target container declares an encoder.
    return Boolean(getVideoFallbackCodec(target));
  });

  const slowExtensions = new Set(
    !isAudioSource && entry.videoMimeType
      ? videoContainers.filter(target => requiresVideoReencode({
        videoMimeType: entry.videoMimeType!,
        targetExtension: target
      }))
      : []
  );

  const groups = buildFormatGroups({ allowedExtensions });
  const withSlow = groups.map(group => ({
    ...group,
    items: group.items.map(item => slowExtensions.has(item.extension)
      ? {
        ...item,
        isSlow: true
      }
      : item)
  }));

  if (isAudioSource) {
    return withSlow;
  }

  return withSlow.map(group => group.heading === "Audio"
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

export function findTargetItem(groups: FormatGroup[], extension: string): FormatItem | undefined {
  for (const group of groups) {
    const found = group.items.find(item => item.extension === extension);
    if (found) {
      return found;
    }
  }

  return undefined;
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

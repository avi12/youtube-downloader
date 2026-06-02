import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import {
  audioContainers,
  buildFormatGroups,
  getVideoFallbackCodec,
  requiresVideoReencode,
  splitFilenameAndExtension,
  videoContainers
} from "@/lib/utils/containers";
import type { FormatGroup } from "@/lib/utils/containers";
import type { RecentDownloadEntry } from "@/types";

export function isAudioSourceEntry(entry: RecentDownloadEntry) {
  return audioContainers.includes(entry.container) && !videoContainers.includes(entry.container);
}

type BuildAvailableTargetGroupsParams = {
  entry: RecentDownloadEntry;
};
function isVideoTargetWithMime(target: string, entry: RecentDownloadEntry, isAudioSource: boolean): boolean {
  return !isAudioSource && videoContainers.includes(target) && Boolean(entry.videoMimeType);
}

function canReencodeTarget(target: string, videoMimeType: string): boolean {
  return !requiresVideoReencode({
    videoMimeType,
    targetExtension: target
  })
    || Boolean(getVideoFallbackCodec(target));
}

function isTargetAllowed(target: string, entry: RecentDownloadEntry, isAudioSource: boolean): boolean {
  if (!isVideoTargetWithMime(target, entry, isAudioSource)) {
    return true;
  }

  return canReencodeTarget(target, entry.videoMimeType!);
}

function buildSlowExtensions(entry: RecentDownloadEntry, isAudioSource: boolean): Set<string> {
  if (isAudioSource || !entry.videoMimeType) {
    return new Set();
  }

  return new Set(videoContainers.filter(target => requiresVideoReencode({
    videoMimeType: entry.videoMimeType!,
    targetExtension: target
  })));
}

export function buildAvailableTargetGroups({ entry }: BuildAvailableTargetGroupsParams): FormatGroup[] {
  const isAudioSource = isAudioSourceEntry(entry);
  const baseAllowed = isAudioSource ? audioContainers : [...videoContainers, ...audioContainers];
  const allowedExtensions = baseAllowed.filter(target => isTargetAllowed(target, entry, isAudioSource));
  const slowExtensions = buildSlowExtensions(entry, isAudioSource);
  const groups = buildFormatGroups({ allowedExtensions });
  const withFlags = groups.map(group => ({
    ...group,
    items: group.items.map(item => ({
      ...item,
      isSlow: slowExtensions.has(item.extension),
      isCurrent: item.extension === entry.container
    }))
  }));
  if (isAudioSource) {
    return withFlags;
  }

  return withFlags.map(group => group.heading === "Audio" ? {
    ...group,
    caption: "Extract audio as"
  } : group);
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
  const isReady = !!selectedTarget && !isSubmitting;
  if (!isReady) {
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

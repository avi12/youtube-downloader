import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import {
  audioContainers,
  buildFormatGroups,
  flattenFormatGroups,
  isCompatibleForRemux,
  MULTI_TRACK_UNSUPPORTED_EXTENSIONS,
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
  isMultiTrack?: boolean;
};
export function buildAvailableTargetGroups({
  entry, isMultiTrack = false
}: BuildAvailableTargetGroupsParams): FormatGroup[] {
  const isAudioSource = isAudioSourceEntry(entry);
  // Audio sources can only re-target audio containers (no audio -> video).
  // Video sources can re-target video containers or extract to audio.
  const allowedExtensions = isAudioSource ? audioContainers : [...videoContainers, ...audioContainers];

  const remuxIncompatibleVideo = !isAudioSource && entry.videoMimeType
    ? videoContainers.filter(target => !isCompatibleForRemux({
      videoMimeType: entry.videoMimeType!,
      audioMimeType: entry.audioMimeType ?? "",
      targetExtension: target
    }))
    : [];
  const multiTrackExcluded = isMultiTrack ? [...MULTI_TRACK_UNSUPPORTED_EXTENSIONS] : [];

  const groups = buildFormatGroups({
    allowedExtensions,
    excludedExtensions: [...remuxIncompatibleVideo, ...multiTrackExcluded, entry.container]
  });
  // The current container is still listed (as excluded) by default; strip it
  // outright since "convert to the same format" is never a useful target.
  return groups
    .map(group => ({
      heading: group.heading,
      items: group.items.filter(item => item.extension !== entry.container)
    }))
    .filter(group => group.items.length > 0);
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

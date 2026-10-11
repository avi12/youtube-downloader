import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import {
  audioContainers,
  buildFormatGroups,
  FFMPEG_CODEC_COPY,
  FORMAT_GROUP_AUDIO,
  FORMAT_GROUP_VIDEO,
  getVideoFallbackCodec,
  isSlowDecodeCodec,
  isSlowVideoEncoder,
  requiresVideoReencode,
  resolveAudioCodec,
  splitFilenameAndExtension,
  TranscodeSpeed,
  videoContainers
} from "@/lib/utils/containers";
import type { FormatGroup } from "@/lib/utils/containers";
import type { Prettify, RecentDownloadEntry } from "@/types";

export function isAudioSourceEntry(entry: RecentDownloadEntry) {
  // Audio-only downloads have no video mime type recorded, regardless of
  // container — e.g. an Opus stream in a .webm container is audio-only.
  if (!entry.videoMimeType) {
    return true;
  }

  return audioContainers.includes(entry.container) && !videoContainers.includes(entry.container);
}

type BuildAvailableTargetGroupsParams = Prettify<{
  entry: RecentDownloadEntry;
}>;
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

function classifyVideoTargetSpeed(target: string, videoMimeType: string): TranscodeSpeed {
  const needsReencode = requiresVideoReencode({
    videoMimeType,
    targetExtension: target
  });
  if (!needsReencode) {
    return TranscodeSpeed.Instant;
  }

  const encoder = getVideoFallbackCodec(target);
  const isSlowDueToEncoder = isSlowVideoEncoder(encoder);
  const isSlowDueToDecoder = isSlowDecodeCodec(videoMimeType);
  if (isSlowDueToEncoder || isSlowDueToDecoder) {
    return TranscodeSpeed.Slower;
  }

  return TranscodeSpeed.ReEncodes;
}

function isAudioReencodeNeeded(target: string, entry: RecentDownloadEntry) {
  return resolveAudioCodec({
    audioMimeType: entry.audioMimeType ?? "",
    targetExtension: target
  }) !== FFMPEG_CODEC_COPY;
}

function classifyTargetSpeed(target: string, entry: RecentDownloadEntry, isVideoTarget: boolean) {
  const videoSpeed = isVideoTarget && entry.videoMimeType
    ? classifyVideoTargetSpeed(target, entry.videoMimeType)
    : TranscodeSpeed.Instant;
  const isOnlyAudioReencoded = videoSpeed === TranscodeSpeed.Instant && isAudioReencodeNeeded(target, entry);
  return isOnlyAudioReencoded ? TranscodeSpeed.ReEncodes : videoSpeed;
}

export function buildAvailableTargetGroups({ entry }: BuildAvailableTargetGroupsParams): FormatGroup[] {
  const isAudioSource = isAudioSourceEntry(entry);
  const baseAllowed = isAudioSource ? audioContainers : [...videoContainers, ...audioContainers];
  const allowedExtensions = baseAllowed.filter(target => isTargetAllowed(target, entry, isAudioSource));
  const groups = buildFormatGroups({ allowedExtensions });
  const withFlags = groups.map(group => {
    const items = group.items.map(item => {
      const isCurrent = item.extension === entry.container;
      const transcodeSpeed = classifyTargetSpeed(item.extension, entry, group.heading === FORMAT_GROUP_VIDEO);
      return {
        ...item,
        isCurrent,
        isSlow: transcodeSpeed === TranscodeSpeed.Slower,
        transcodeSpeed
      };
    });
    const iCurrent = items.findIndex(item => item.isCurrent);
    if (iCurrent > 0) {
      const [current] = items.splice(iCurrent, 1);
      items.unshift(current);
    }

    return {
      ...group,
      items
    };
  });
  if (isAudioSource) {
    return withFlags;
  }

  return withFlags.map(group => group.heading === FORMAT_GROUP_AUDIO ? {
    ...group,
    caption: "Extract audio as"
  } : group);
}

type SubmitTranscodeParams = Prettify<{
  entry: RecentDownloadEntry;
  selectedTarget: string;
  isSubmitting: boolean;
}>;
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

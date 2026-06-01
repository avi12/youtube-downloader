import { audioContainers, getFormatDescription, videoContainers } from "./mime-types";

export const FORMAT_GROUP_VIDEO = "Video";
export const FORMAT_GROUP_AUDIO = "Audio";

export type FormatGroupHeading = typeof FORMAT_GROUP_VIDEO | typeof FORMAT_GROUP_AUDIO;

export type FormatItem = {
  extension: string;
  description: string;
  group: FormatGroupHeading;
  isExcluded: boolean;
  isSlow?: boolean;
};

export type FormatGroup = {
  heading: FormatGroupHeading;
  caption?: string;
  items: FormatItem[];
};

const videoTargetSet = new Set(videoContainers);

type BuildFormatGroupsParams = {
  /** Restrict to a subset of supported extensions; `undefined` includes all. */
  allowedExtensions?: Iterable<string>;
  /** Extensions to mark as `isExcluded` (rendered but disabled). */
  excludedExtensions?: Iterable<string>;
};

/**
 * Canonical Video/Audio grouping used by every format picker (watch-page
 * panel, popup settings, change-format dialog). Order within each group is
 * inherited from `videoContainers`/`audioContainers` in mime-types.ts, which
 * is ranked highest-quality / most-relevant first.
 */
export function buildFormatGroups(
  { allowedExtensions, excludedExtensions }: BuildFormatGroupsParams = {}
): FormatGroup[] {
  const allowed = allowedExtensions ? new Set(allowedExtensions) : null;
  const excluded = excludedExtensions ? new Set(excludedExtensions) : null;
  function toItem(extension: string, group: FormatGroupHeading): FormatItem {
    return {
      extension,
      description: getFormatDescription(extension),
      group,
      isExcluded: excluded?.has(extension) ?? false
    };
  }

  const videoItems = videoContainers
    .filter(extension => !allowed || allowed.has(extension))
    .map(extension => toItem(extension, FORMAT_GROUP_VIDEO));
  const audioItems = audioContainers
    .filter(extension => !videoTargetSet.has(extension))
    .filter(extension => !allowed || allowed.has(extension))
    .map(extension => toItem(extension, FORMAT_GROUP_AUDIO));

  const groups: FormatGroup[] = [];
  if (videoItems.length > 0) {
    groups.push({
      heading: FORMAT_GROUP_VIDEO,
      items: videoItems
    });
  }

  if (audioItems.length > 0) {
    groups.push({
      heading: FORMAT_GROUP_AUDIO,
      items: audioItems
    });
  }

  return groups;
}

export function flattenFormatGroups(groups: FormatGroup[]): FormatItem[] {
  return groups.flatMap(group => group.items);
}

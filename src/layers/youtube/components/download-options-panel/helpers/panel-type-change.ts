import { CONTENT_OPTIONS } from "@/lib/ui/synced-stores.svelte";
import { resolveAutoExtension } from "@/lib/utils/containers";
import { DownloadType, type AdaptiveFormatItem } from "@/types";

export function applyDownloadTypeChange({
  newType,
  selectedVideoFormat,
  selectedAudioFormat
}: {
  newType: DownloadType;
  selectedVideoFormat: AdaptiveFormatItem | null;
  selectedAudioFormat: AdaptiveFormatItem | null;
}): {
  downloadType: DownloadType;
  extension: string;
} {
  const options = CONTENT_OPTIONS;
  const extensionPreference = newType === DownloadType.Audio ? options.ext.audio : options.ext.video;
  const format = newType === DownloadType.Audio ? selectedAudioFormat : selectedVideoFormat;
  const extension = resolveAutoExtension({
    extension: extensionPreference,
    mimeType: format?.mimeType ?? "",
    isAudio: newType === DownloadType.Audio
  });
  return {
    downloadType: newType,
    extension
  };
}

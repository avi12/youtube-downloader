import { CONTENT_OPTIONS, downloadProgressStore } from "@/lib/ui/synced-stores.svelte";
import { resolveAutoExtension } from "@/lib/utils/containers";
import { DownloadType, type AdaptiveFormatItem } from "@/types";

export function applyDownloadTypeChange({
  newType,
  selectedVideoFormat,
  selectedAudioFormat,
  videoId
}: {
  newType: DownloadType;
  selectedVideoFormat: AdaptiveFormatItem | null;
  selectedAudioFormat: AdaptiveFormatItem | null;
  videoId: string;
}): {
  downloadType: DownloadType;
  extension: string;
} {
  const options = CONTENT_OPTIONS.value;
  downloadProgressStore.setLocal(videoId, {
    isDownloading: false,
    isDone: false,
    progress: 0,
    progressType: ""
  });
  const extensionPreference = newType === DownloadType.Audio ? options.ext.audio : options.ext.video;
  const format = newType === DownloadType.Audio ? selectedAudioFormat : selectedVideoFormat;
  const extension = resolveAutoExtension({
    extension: extensionPreference,
    mimeType: format?.mimeType ?? ""
  });
  return {
    downloadType: newType,
    extension
  };
}

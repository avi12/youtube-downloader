import { CONTENT_OPTIONS } from "@/lib/ui/synced-stores.svelte";
import { resolveAutoContainer } from "@/lib/youtube/auto-container";
import { DownloadType, type AdaptiveFormatItem, type CodecPreferences, type VideoData } from "@/types";

export function applyDownloadTypeChange({
  newType,
  selectedVideoFormat,
  selectedAudioFormat,
  videoData,
  codecPreferences
}: {
  newType: DownloadType;
  selectedVideoFormat: AdaptiveFormatItem | null;
  selectedAudioFormat: AdaptiveFormatItem | null;
  videoData: VideoData;
  codecPreferences: CodecPreferences;
}): {
  downloadType: DownloadType;
  extension: string;
} {
  const options = CONTENT_OPTIONS;
  const extensionPreference = newType === DownloadType.Audio ? options.ext.audio : options.ext.video;
  const format = newType === DownloadType.Audio ? selectedAudioFormat : selectedVideoFormat;
  const extension = resolveAutoContainer({
    extension: extensionPreference,
    videoData,
    sourceMimeType: format?.mimeType ?? "",
    codecPreferences,
    isAudio: newType === DownloadType.Audio
  });
  return {
    downloadType: newType,
    extension
  };
}

import {
  buildQualityOptions,
  buildUniqueAudioLanguages,
  byLabel,
  resolveCaptionOriginalLabel
} from "./download-options-helpers";
import { findOriginalAudioFormat } from "@/lib/youtube/video-helpers";
import { DownloadType } from "@/types";
import type { AdaptiveFormatItem, CaptionTrack } from "@/types";

export interface DownloadOptionsProps {
  downloadType: DownloadType;
  videoFormats: AdaptiveFormatItem[];
  audioFormats: AdaptiveFormatItem[];
  captionTracks: CaptionTrack[];
  selectedVideoFormat: AdaptiveFormatItem | null;
  selectedAudioFormat: AdaptiveFormatItem | null;
  selectedCaptionTrack: CaptionTrack | null;
}

export function createDownloadOptionsState(props: () => DownloadOptionsProps) {
  const isAudio = $derived(props().downloadType === DownloadType.Audio);

  const uniqueAudioLanguages = $derived(buildUniqueAudioLanguages(props().audioFormats));

  const qualityOptions = $derived(
    buildQualityOptions(
      isAudio,
      props().audioFormats,
      props().videoFormats,
      props().selectedAudioFormat?.audioTrack?.id,
      uniqueAudioLanguages.length
    )
  );

  const qualityValue = $derived(
    isAudio
      ? `${props().selectedAudioFormat?.itag ?? ""}:${props().selectedAudioFormat?.audioTrack?.id ?? ""}`
      : (props().selectedVideoFormat?.itag.toString() ?? "")
  );

  const captionCustomOptions = $derived(
    props().captionTracks.map(track => ({
      value: track.vssId,
      label: track.name.simpleText
    })).toSorted(byLabel)
  );

  const captionOriginalLabel = $derived(resolveCaptionOriginalLabel(props().audioFormats, props().captionTracks));
  const audioPlayerLabel = $derived(props().selectedAudioFormat?.audioTrack?.displayName ?? null);
  const audioOriginalLabel = $derived(findOriginalAudioFormat(props().audioFormats)?.audioTrack?.displayName ?? null);
  const captionPlayerLabel = $derived(props().selectedCaptionTrack?.name.simpleText ?? null);
  const selectedCaptionVssId = $derived(props().selectedCaptionTrack?.vssId ?? "");

  return {
    get isAudio() {
      return isAudio;
    },
    get uniqueAudioLanguages() {
      return uniqueAudioLanguages;
    },
    get qualityOptions() {
      return qualityOptions;
    },
    get qualityValue() {
      return qualityValue;
    },
    get captionCustomOptions() {
      return captionCustomOptions;
    },
    get captionOriginalLabel() {
      return captionOriginalLabel;
    },
    get audioPlayerLabel() {
      return audioPlayerLabel;
    },
    get audioOriginalLabel() {
      return audioOriginalLabel;
    },
    get captionPlayerLabel() {
      return captionPlayerLabel;
    },
    get selectedCaptionVssId() {
      return selectedCaptionVssId;
    }
  };
}

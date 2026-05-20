import { optionsToQualityValue } from "./helpers/playlist-download-builder";
import { CONTENT_OPTIONS } from "@/lib/ui/synced-stores.svelte";
import type { DownloadTypePreference } from "@/types";

let downloadTypeOverride = $state<DownloadTypePreference | null>(null);
let videoExtOverride = $state<string | null>(null);
let audioExtOverride = $state<string | null>(null);
let videoQualityOverride = $state<string | null>(null);
let zipNameOverride = $state<string | null>(null);

export function createOverrideState(getDefaultZipName: () => string) {
  const effectiveDownloadType = $derived<DownloadTypePreference>(
    downloadTypeOverride ?? CONTENT_OPTIONS.defaultDownloadType
  );
  const effectiveVideoExt = $derived(videoExtOverride ?? CONTENT_OPTIONS.ext.video);
  const effectiveAudioExt = $derived(audioExtOverride ?? CONTENT_OPTIONS.ext.audio);
  const effectiveQuality = $derived(videoQualityOverride ?? optionsToQualityValue(CONTENT_OPTIONS));
  const effectiveZipName = $derived(zipNameOverride ?? getDefaultZipName());
  const isAnyOverrideActive = $derived(
    downloadTypeOverride !== null
    || videoExtOverride !== null
    || audioExtOverride !== null
    || videoQualityOverride !== null
    || zipNameOverride !== null
  );

  function resetOverrides() {
    downloadTypeOverride = null;
    videoExtOverride = null;
    audioExtOverride = null;
    videoQualityOverride = null;
    zipNameOverride = null;
  }

  return {
    get effectiveDownloadType() {
      return effectiveDownloadType;
    },
    set effectiveDownloadType(value) {
      downloadTypeOverride = value === CONTENT_OPTIONS.defaultDownloadType ? null : value;
    },
    get effectiveVideoExt() {
      return effectiveVideoExt;
    },
    set effectiveVideoExt(value) {
      videoExtOverride = value === CONTENT_OPTIONS.ext.video ? null : value;
    },
    get effectiveAudioExt() {
      return effectiveAudioExt;
    },
    set effectiveAudioExt(value) {
      audioExtOverride = value === CONTENT_OPTIONS.ext.audio ? null : value;
    },
    get effectiveQuality() {
      return effectiveQuality;
    },
    set effectiveQuality(value) {
      videoQualityOverride = value === optionsToQualityValue(CONTENT_OPTIONS) ? null : value;
    },
    get effectiveZipName() {
      return effectiveZipName;
    },
    set effectiveZipName(value: string) {
      const trimmed = value.trim();
      const isEmptyOrDefault = !trimmed || trimmed === getDefaultZipName();
      zipNameOverride = isEmptyOrDefault ? null : trimmed;
    },
    get isAnyOverrideActive() {
      return isAnyOverrideActive;
    },
    get isDownloadTypeOverridden() {
      return downloadTypeOverride !== null;
    },
    get isVideoExtOverridden() {
      return videoExtOverride !== null;
    },
    get isAudioExtOverridden() {
      return audioExtOverride !== null;
    },
    get isQualityOverridden() {
      return videoQualityOverride !== null;
    },
    get isZipNameOverridden() {
      return zipNameOverride !== null;
    },
    resetOverrides
  };
}

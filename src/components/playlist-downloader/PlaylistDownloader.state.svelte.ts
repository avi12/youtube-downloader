import { resolveDefaultZipName } from "./helpers/playlist-download-builder";
import { createBatchDownloadState } from "./PlaylistDownloader.batch.svelte";
import { createOverrideState } from "./PlaylistDownloader.overrides.svelte";
import { createProgressState } from "./PlaylistDownloader.progress.svelte";
import { createRevealState } from "./PlaylistDownloader.reveal.svelte";
import { createVideoDataState } from "./PlaylistDownloader.video-data.svelte";
import { setOption } from "@/lib/storage/storage";
import { checkedPlaylistVideos } from "@/lib/ui/playlist-selection.svelte";
import { CONTENT_OPTIONS, playlistMetadataSignal } from "@/lib/ui/synced-stores.svelte";
import { VideoQualityMode } from "@/types";

let downloadMode = $state(CONTENT_OPTIONS.value.playlistDownloadMode);
let outputMode = $state(CONTENT_OPTIONS.value.playlistOutputMode);
let isScrollSyncEnabled = $state(CONTENT_OPTIONS.value.isPlaylistScrollSyncEnabled);

export function createPlaylistDownloaderState() {
  const videoData = createVideoDataState();

  $effect.pre(() => {
    downloadMode = CONTENT_OPTIONS.value.playlistDownloadMode;
    outputMode = videoData.isAllMusicPlaylist
      ? CONTENT_OPTIONS.value.playlistAudioOutputMode
      : CONTENT_OPTIONS.value.playlistOutputMode;
    isScrollSyncEnabled = CONTENT_OPTIONS.value.isPlaylistScrollSyncEnabled;
  });

  const overrides = createOverrideState(() => resolveDefaultZipName(playlistMetadataSignal.value));

  function buildEffectiveOptions() {
    const base = CONTENT_OPTIONS.value;
    const qualityValue = overrides.effectiveQuality;
    return {
      ...base,
      defaultDownloadType: overrides.effectiveDownloadType,
      ext: {
        video: overrides.effectiveVideoExt,
        audio: overrides.effectiveAudioExt
      },
      videoQualityMode: qualityValue === VideoQualityMode.Best ? VideoQualityMode.Best : VideoQualityMode.Custom,
      videoQuality: qualityValue === VideoQualityMode.Best ? base.videoQuality : Number(qualityValue)
    };
  }

  const batch = createBatchDownloadState(
    () => outputMode,
    () => downloadMode,
    buildEffectiveOptions,
    () => overrides.effectiveZipName
  );

  const reveal = createRevealState(
    () => videoData.videoDataMap.size,
    () => videoData.downloadableVideos,
    batch.startDownload
  );

  const progress = createProgressState(batch, videoData, () => isScrollSyncEnabled);

  return {
    get isDownloading() {
      return batch.isDownloading;
    },
    get downloadedCount() {
      return batch.downloadedCount;
    },
    get totalCount() {
      return batch.totalCount;
    },
    get error() {
      return batch.error;
    },
    get downloadMode() {
      return downloadMode;
    },
    set downloadMode(value) {
      downloadMode = value; void setOption("playlistDownloadMode", value);
    },
    get outputMode() {
      return outputMode;
    },
    set outputMode(value) {
      outputMode = value;
      void setOption(videoData.isAllMusicPlaylist ? "playlistAudioOutputMode" : "playlistOutputMode", value);
    },
    get downloadableVideos() {
      return videoData.downloadableVideos;
    },
    get nonDownloadableCount() {
      return videoData.nonDownloadableCount;
    },
    get selectedDownloadableVideos() {
      return videoData.selectedDownloadableVideos;
    },
    get isAllSelected() {
      return videoData.isAllSelected;
    },
    get downloadButtonLabel() {
      return progress.downloadButtonLabel;
    },
    get availableQualities() {
      return videoData.availableQualities;
    },
    get guaranteedQuality() {
      return videoData.guaranteedQuality;
    },
    get isRevealingAll() {
      return reveal.isRevealingAll;
    },
    get revealedVideoCount() {
      return reveal.revealedVideoCount;
    },
    get isScrollSyncEnabled() {
      return isScrollSyncEnabled;
    },
    set isScrollSyncEnabled(value) {
      isScrollSyncEnabled = value; void setOption("isPlaylistScrollSyncEnabled", value);
    },
    get effectiveDownloadType() {
      return overrides.effectiveDownloadType;
    },
    set effectiveDownloadType(value) {
      overrides.effectiveDownloadType = value;
    },
    get effectiveVideoExt() {
      return overrides.effectiveVideoExt;
    },
    set effectiveVideoExt(value) {
      overrides.effectiveVideoExt = value;
    },
    get effectiveAudioExt() {
      return overrides.effectiveAudioExt;
    },
    set effectiveAudioExt(value) {
      overrides.effectiveAudioExt = value;
    },
    get effectiveQuality() {
      return overrides.effectiveQuality;
    },
    set effectiveQuality(value) {
      overrides.effectiveQuality = value;
    },
    get isAnyOverrideActive() {
      return overrides.isAnyOverrideActive;
    },
    get activeIndividualDownloadCount() {
      return progress.activeIndividualDownloadCount;
    },
    get totalProgress() {
      return progress.totalProgress;
    },
    get completedBatchProgress() {
      return batch.completedBatchProgress;
    },
    get currentPhaseLabel() {
      return progress.currentPhaseLabel;
    },
    get isDownloadTypeOverridden() {
      return overrides.isDownloadTypeOverridden;
    },
    get isVideoExtOverridden() {
      return overrides.isVideoExtOverridden;
    },
    get isAudioExtOverridden() {
      return overrides.isAudioExtOverridden;
    },
    get isQualityOverridden() {
      return overrides.isQualityOverridden;
    },
    get effectiveZipName() {
      return overrides.effectiveZipName;
    },
    set effectiveZipName(value) {
      overrides.effectiveZipName = value;
    },
    get isZipNameOverridden() {
      return overrides.isZipNameOverridden;
    },
    resetOverrides: overrides.resetOverrides,
    toggleSelectedDownload: () => batch.isDownloading
      ? void batch.cancelDownload()
      : void batch.startDownload(videoData.selectedDownloadableVideos),
    revealAndDownloadAll: reveal.revealAndDownloadAll,
    cancelReveal: reveal.cancelReveal,
    selectAll() {
      for (const video of videoData.downloadableVideos) {
        checkedPlaylistVideos.add(video.videoId);
      }
    },
    clearSelection: () => checkedPlaylistVideos.clear()
  };
}

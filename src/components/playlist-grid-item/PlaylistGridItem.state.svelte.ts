import {
  initBatchVideoProgress,
  sendBatchDownloadMessage
} from "@/components/playlist-downloader/helpers/playlist-batch-ops";
import {
  optionsToQualityValue,
  resolveDefaultZipName
} from "@/components/playlist-downloader/helpers/playlist-download-builder";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { completedDownloadsStore } from "@/lib/ui/completed-downloads-store.svelte";
import { PrimaryButtonState } from "@/lib/ui/panel-button-attachments.svelte";
import {
  CONTENT_OPTIONS,
  downloadProgressStore,
  videoDataFailedStore,
  videoDataStore
} from "@/lib/ui/synced-stores.svelte";
import { resolveVideoFilename } from "@/lib/utils/containers";
import { normalizeLanguageCode } from "@/lib/youtube/audio-format-helpers";
import { fetchPlaylistContents } from "@/lib/youtube/playlist-fetch";
import {
  DownloadType,
  PlaylistOutputMode,
  ProgressType,
  VideoQualityMode,
  type AdaptiveFormatItem,
  type CaptionTrack,
  type DownloadRequest,
  type Options,
  type VideoData
} from "@/types";

const VIDEO_DATA_TIMEOUT_MS = 30_000;
const VIDEO_DATA_POLL_INTERVAL_MS = 100;
const PLAYLIST_FALLBACK_TITLE_PREFIX = "Playlist";
const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;
const BYTES_PER_GB = 1024 * 1024 * 1024;
const SIZE_DECIMALS = 1;
const FALLBACK_AUDIO_LANGUAGE = "en";
const CAPTION_KIND_ASR = "asr";

function pickAudioFormatForLanguage({ audioFormats, langCode }: {
  audioFormats: AdaptiveFormatItem[];
  langCode: string;
}) {
  return audioFormats.find(format => {
    const formatLang = format.audioTrack?.id;
    return formatLang ? normalizeLanguageCode(formatLang) === langCode : false;
  }) ?? null;
}

function selectPlaylistAudioFormat(audioFormats: AdaptiveFormatItem[]) {
  if (audioFormats.length === 0) {
    return null;
  }

  const hasMultipleTracks = audioFormats.some(format => format.audioTrack);
  if (!hasMultipleTracks) {
    return audioFormats[0];
  }

  const preferredLanguages = [
    CONTENT_OPTIONS.customLanguage,
    document.documentElement.lang,
    navigator.language,
    FALLBACK_AUDIO_LANGUAGE
  ];

  for (const language of preferredLanguages) {
    if (!language) {
      continue;
    }

    const match = pickAudioFormatForLanguage({
      audioFormats,
      langCode: normalizeLanguageCode(language)
    });
    if (match) {
      return match;
    }
  }

  return audioFormats[0];
}

function filterCaptionTracks(captionTracks: CaptionTrack[]) {
  if (CONTENT_OPTIONS.includeAiCaptions) {
    return captionTracks;
  }

  const allTracksAreAsr = captionTracks.length > 0 && captionTracks.every(track => track.kind === CAPTION_KIND_ASR);
  if (allTracksAreAsr) {
    return captionTracks;
  }

  return captionTracks.filter(track => track.kind !== CAPTION_KIND_ASR);
}

export const PlaylistGridStatus = {
  Idle: "idle",
  Fetching: "fetching",
  Loading: "loading",
  Downloading: "downloading",
  Done: "done",
  Failed: "failed"
} as const;
export type PlaylistGridStatus = (typeof PlaylistGridStatus)[keyof typeof PlaylistGridStatus];

function formatSize(bytes: number) {
  if (bytes <= 0) {
    return "";
  }

  if (bytes >= BYTES_PER_GB) {
    return `${(bytes / BYTES_PER_GB).toFixed(SIZE_DECIMALS)} GB`;
  }

  if (bytes >= BYTES_PER_MB) {
    return `${(bytes / BYTES_PER_MB).toFixed(SIZE_DECIMALS)} MB`;
  }

  if (bytes >= BYTES_PER_KB) {
    return `${Math.round(bytes / BYTES_PER_KB)} KB`;
  }

  return `${bytes} B`;
}

function estimateVideoSize({ video, options }: {
  video: VideoData;
  options: Options;
}) {
  const selectedAudio = selectPlaylistAudioFormat(video.audioFormats);
  const audioBytes = Number(selectedAudio?.contentLength ?? 0);
  const isAudioOnly = options.defaultDownloadType === DownloadType.Audio
    || (options.defaultDownloadType === DownloadType.Auto && video.isMusic);
  if (isAudioOnly) {
    return audioBytes;
  }

  const targetHeight = options.videoQualityMode === VideoQualityMode.Best
    ? Number.POSITIVE_INFINITY
    : options.videoQuality;
  const videoFormat = options.videoQualityMode === VideoQualityMode.Best
    ? video.videoFormats[0]
    : (video.videoFormats.find(format => format.height === targetHeight) ?? video.videoFormats[0]);
  const videoBytes = Number(videoFormat?.contentLength ?? 0);

  const isVideoOnly = options.defaultDownloadType === DownloadType.Video;
  if (isVideoOnly) {
    return videoBytes;
  }

  return videoBytes + audioBytes;
}

type BuildPlaylistGridRequestParams = {
  data: VideoData;
  options: Options;
  playlistId: string;
  playlistTitle: string;
  playlistTotalCount: number;
  isZipBundle: boolean;
};
function buildPlaylistGridRequest({
  data,
  options,
  playlistId,
  playlistTitle,
  playlistTotalCount,
  isZipBundle
}: BuildPlaylistGridRequestParams): DownloadRequest {
  const downloadType = data.isMusic ? DownloadType.Audio : DownloadType.VideoAndAudio;

  const videoFormat = options.videoQualityMode === VideoQualityMode.Best
    ? data.videoFormats[0]
    : (data.videoFormats.find(format => format.height === options.videoQuality) ?? data.videoFormats[0]);
  const audioFormat = selectPlaylistAudioFormat(data.audioFormats);
  const captionTracks = filterCaptionTracks(data.captionTracks);

  return {
    type: downloadType,
    videoId: data.videoId,
    videoItag: videoFormat?.itag ?? 0,
    audioItag: audioFormat?.itag ?? 0,
    audioTrackId: audioFormat?.audioTrack?.id,
    filenameOutput: resolveVideoFilename({
      videoData: data,
      options
    }),
    sabrConfig: data.sabrConfig,
    downloadExtras: false,
    downloadExtraCaptions: true,
    includeAutoDubbing: false,
    captionTracks,
    ...(isZipBundle && {
      playlistId,
      playlistTitle,
      playlistTotalCount
    })
  };
}

type CreatePlaylistGridItemStateParams = {
  playlistId: string;
  gridTitle: string;
};
export function createPlaylistGridItemState({ playlistId, gridTitle }: CreatePlaylistGridItemStateParams) {
  let qualityOverride = $state<string | null>(null);
  let outputModeOverride = $state<PlaylistOutputMode | null>(null);
  let videoExtOverride = $state<string | null>(null);
  let audioExtOverride = $state<string | null>(null);
  let zipNameOverride = $state<string | null>(null);

  let status = $state<PlaylistGridStatus>(PlaylistGridStatus.Idle);
  let errorMessage = $state("");
  let totalCount = $state(0);
  let resolvedTitle = $state(gridTitle);
  let playlistVideoIds = $state<readonly string[]>([]);

  const loadedVideos = $derived.by<readonly VideoData[]>(() => {
    const videos: VideoData[] = [];
    for (const videoId of playlistVideoIds) {
      const data = videoDataStore.get(videoId);
      if (data?.isDownloadable) {
        videos.push(data);
      }
    }
    return videos;
  });

  const effectiveQuality = $derived(qualityOverride ?? optionsToQualityValue(CONTENT_OPTIONS));
  const effectiveOutputMode = $derived(outputModeOverride ?? CONTENT_OPTIONS.playlistOutputMode);
  const effectiveVideoExt = $derived(videoExtOverride ?? CONTENT_OPTIONS.ext.video);
  const effectiveAudioExt = $derived(audioExtOverride ?? CONTENT_OPTIONS.ext.audio);

  const defaultZipName = $derived(
    resolveDefaultZipName({
      playlistId,
      playlistTitle: resolvedTitle,
      playlistOwner: ""
    })
  );
  const effectiveZipName = $derived(zipNameOverride ?? defaultZipName);

  const isWorking = $derived(
    status === PlaylistGridStatus.Fetching
    || status === PlaylistGridStatus.Loading
    || status === PlaylistGridStatus.Downloading
  );

  const primaryState = $derived.by<PrimaryButtonState>(() => {
    if (status === PlaylistGridStatus.Downloading) {
      return PrimaryButtonState.Downloading;
    }

    if (status === PlaylistGridStatus.Done) {
      return PrimaryButtonState.Done;
    }

    if (status === PlaylistGridStatus.Failed) {
      return PrimaryButtonState.Failed;
    }

    return PrimaryButtonState.Idle;
  });

  function buildOptions(): Options {
    return {
      ...CONTENT_OPTIONS,
      defaultDownloadType: DownloadType.Auto,
      ext: {
        video: effectiveVideoExt,
        audio: effectiveAudioExt
      },
      videoQualityMode: effectiveQuality === VideoQualityMode.Best ? VideoQualityMode.Best : VideoQualityMode.Custom,
      videoQuality: effectiveQuality === VideoQualityMode.Best ? CONTENT_OPTIONS.videoQuality : Number(effectiveQuality)
    };
  }

  const isMetadataComplete = $derived(
    playlistVideoIds.length > 0
    && playlistVideoIds.every(id => videoDataStore.get(id) || videoDataFailedStore.get(id))
  );

  const estimatedTotalBytes = $derived.by(() => {
    if (!isMetadataComplete || loadedVideos.length === 0) {
      return 0;
    }

    const options = buildOptions();
    let total = 0;
    for (const video of loadedVideos) {
      total += estimateVideoSize({
        video,
        options
      });
    }
    return total;
  });
  const estimatedSizeLabel = $derived(estimatedTotalBytes > 0 ? `~${formatSize(estimatedTotalBytes)}` : "");

  const aggregateProgress = $derived.by(() => {
    if (loadedVideos.length === 0) {
      return 0;
    }

    let totalProgress = 0;
    let hasFFmpegProgress = false;
    let progressEntryCount = 0;

    for (const video of loadedVideos) {
      const entry = downloadProgressStore.get(video.videoId);
      if (!entry) {
        continue;
      }

      progressEntryCount++;

      if (entry.isDone) {
        totalProgress += 100;
        continue;
      }

      if (entry.progressType === ProgressType.FFmpeg) {
        hasFFmpegProgress = true;
      }

      totalProgress += entry.progress ?? 0;
    }

    if (progressEntryCount === 0) {
      return {
        progress: 0,
        progressType: ""
      };
    }

    return {
      progress: totalProgress / loadedVideos.length,
      progressType: hasFFmpegProgress ? ProgressType.FFmpeg : ""
    };
  });

  const displayProgress = $derived(typeof aggregateProgress === "number" ? 0 : aggregateProgress.progress);
  const progressType = $derived(typeof aggregateProgress === "number" ? "" : aggregateProgress.progressType);

  const completedDownloadId = $derived(completedDownloadsStore.get(playlistId)?.downloadId ?? null);
  const isZipDownload = $derived(effectiveOutputMode === PlaylistOutputMode.Zip);

  const availableQualities = $derived.by(() => {
    const allHeights: number[] = [];
    for (const video of loadedVideos) {
      for (const format of video.videoFormats) {
        const isHeightPresent = !!format.height;
        if (isHeightPresent) {
          allHeights.push(format.height!);
        }
      }
    }
    allHeights.sort((heightA, heightB) => heightB - heightA);
    return allHeights.filter((height, iHeight) => iHeight === 0 || height !== allHeights[iHeight - 1]);
  });

  const guaranteedQuality = $derived.by(() => {
    if (loadedVideos.length === 0) {
      return 0;
    }

    let minimum = Infinity;
    for (const video of loadedVideos) {
      let videoMax = 0;
      for (const format of video.videoFormats) {
        const height = format.height ?? 0;
        if (height > videoMax) {
          videoMax = height;
        }
      }

      if (videoMax < minimum) {
        minimum = videoMax;
      }
    }
    return minimum === Infinity ? 0 : minimum;
  });

  function kickOffVideoDataRequests(videoIds: readonly string[]) {
    for (const videoId of videoIds) {
      const isAlreadyLoaded = videoDataStore.get(videoId);
      const isAlreadyFailed = videoDataFailedStore.get(videoId);
      if (isAlreadyLoaded || isAlreadyFailed) {
        continue;
      }

      void crossWorldMessenger.sendMessage(CrossWorldMessage.RequestVideoData, { videoId });
    }
  }

  async function awaitVideoData(videoIds: readonly string[]) {
    kickOffVideoDataRequests(videoIds);

    const deadline = Date.now() + VIDEO_DATA_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const isComplete = videoIds.every(id => videoDataStore.get(id) || videoDataFailedStore.get(id));
      if (isComplete) {
        break;
      }

      await new Promise(resolve => setTimeout(resolve, VIDEO_DATA_POLL_INTERVAL_MS));
    }

    const videos: VideoData[] = [];
    for (const videoId of videoIds) {
      const data = videoDataStore.get(videoId);
      if (data?.isDownloadable) {
        videos.push(data);
      }
    }
    return videos;
  }

  let metadataPromise: Promise<readonly VideoData[]> | null = null;

  async function ensureMetadataLoaded() {
    if (metadataPromise) {
      return metadataPromise;
    }

    metadataPromise = (async () => {
      errorMessage = "";

      const contents = await fetchPlaylistContents(playlistId);
      if (!contents || contents.videoIds.length === 0) {
        errorMessage = "Could not fetch playlist";
        metadataPromise = null;
        return [];
      }

      totalCount = contents.videoIds.length;
      resolvedTitle = contents.title || gridTitle || `${PLAYLIST_FALLBACK_TITLE_PREFIX} ${playlistId}`;
      playlistVideoIds = contents.videoIds;

      kickOffVideoDataRequests(contents.videoIds);
      return awaitVideoData(contents.videoIds);
    })();

    return metadataPromise;
  }

  async function startDownload() {
    if (isWorking) {
      return;
    }

    status = PlaylistGridStatus.Fetching;
    errorMessage = "";

    const videos = await ensureMetadataLoaded();
    if (videos.length === 0) {
      status = PlaylistGridStatus.Failed;
      errorMessage = errorMessage || "No downloadable videos in playlist";
      return;
    }

    const isZipBundle = effectiveOutputMode === PlaylistOutputMode.Zip;
    const options = buildOptions();
    const downloadRequests = videos.map(data => buildPlaylistGridRequest({
      data,
      options,
      playlistId,
      playlistTitle: effectiveZipName,
      playlistTotalCount: videos.length,
      isZipBundle
    }));

    initBatchVideoProgress(videos);

    status = PlaylistGridStatus.Downloading;
    try {
      await sendBatchDownloadMessage({
        downloadRequests,
        zipName: effectiveZipName,
        isZipBundle,
        getDownloadMode: () => CONTENT_OPTIONS.playlistDownloadMode
      });
    } catch {
      status = PlaylistGridStatus.Failed;
      errorMessage = "Failed to start downloads";
    }
  }

  function cancelDownload() {
    const videoIds = loadedVideos.map(video => video.videoId);
    if (videoIds.length > 0) {
      void sendMessage(MessageType.CancelDownload, { videoIds });
    }

    status = PlaylistGridStatus.Idle;
  }

  function revealDownload() {
    if (completedDownloadId === null) {
      return;
    }

    void sendMessage(MessageType.RevealDownloadFile, { downloadId: completedDownloadId });
  }

  function handlePrimaryClick() {
    if (status === PlaylistGridStatus.Downloading) {
      cancelDownload();
      return;
    }

    void startDownload();
  }

  $effect.root(() => {
    $effect(() => {
      const allDone = loadedVideos.length > 0
        && loadedVideos.every(video => downloadProgressStore.get(video.videoId)?.isDone);
      if (!allDone) {
        return;
      }

      if (isZipDownload && completedDownloadId === null) {
        return;
      }

      if (status === PlaylistGridStatus.Downloading) {
        status = PlaylistGridStatus.Done;
      }
    });
  });

  function resetOverrides() {
    qualityOverride = null;
    outputModeOverride = null;
    videoExtOverride = null;
    audioExtOverride = null;
    zipNameOverride = null;
  }

  return {
    get status() {
      return status;
    },
    get isWorking() {
      return isWorking;
    },
    get errorMessage() {
      return errorMessage;
    },
    get totalCount() {
      return totalCount;
    },
    get primaryState() {
      return primaryState;
    },
    get displayProgress() {
      return displayProgress;
    },
    get progressType() {
      return progressType;
    },
    get estimatedSizeLabel() {
      return estimatedSizeLabel;
    },
    get isReadyToDownload() {
      return !isWorking;
    },
    get completedDownloadId() {
      return completedDownloadId;
    },
    get availableQualities() {
      return availableQualities;
    },
    get guaranteedQuality() {
      return guaranteedQuality;
    },
    get isMetadataLoaded() {
      return isMetadataComplete;
    },
    get effectiveQuality() {
      return effectiveQuality;
    },
    set effectiveQuality(value: string) {
      qualityOverride = value === optionsToQualityValue(CONTENT_OPTIONS) ? null : value;
    },
    get effectiveOutputMode() {
      return effectiveOutputMode;
    },
    set effectiveOutputMode(value: PlaylistOutputMode) {
      outputModeOverride = value === CONTENT_OPTIONS.playlistOutputMode ? null : value;
    },
    get effectiveVideoExt() {
      return effectiveVideoExt;
    },
    set effectiveVideoExt(value: string) {
      videoExtOverride = value === CONTENT_OPTIONS.ext.video ? null : value;
    },
    get effectiveAudioExt() {
      return effectiveAudioExt;
    },
    set effectiveAudioExt(value: string) {
      audioExtOverride = value === CONTENT_OPTIONS.ext.audio ? null : value;
    },
    get effectiveZipName() {
      return effectiveZipName;
    },
    set effectiveZipName(value: string) {
      const trimmed = value.trim();
      const isEmptyOrDefault = !trimmed || trimmed === defaultZipName;
      zipNameOverride = isEmptyOrDefault ? null : trimmed;
    },
    get isZipNameOverridden() {
      return zipNameOverride !== null;
    },
    get isAnyOverrideActive() {
      return qualityOverride !== null
        || outputModeOverride !== null
        || videoExtOverride !== null
        || audioExtOverride !== null
        || zipNameOverride !== null;
    },
    startDownload,
    ensureMetadataLoaded,
    cancelDownload,
    revealDownload,
    handlePrimaryClick,
    resetOverrides
  };
}

import { cancelStreamTransfer } from "@/entrypoints/youtube.content/download/stream-transfer";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { statusProgressItem, videoQueueItem } from "@/lib/storage/storage";
import { completedDownloadsStore } from "@/lib/ui/completed-downloads-store.svelte";
import { PrimaryButtonState } from "@/lib/ui/panel-button-attachments.svelte";
import { CONTENT_OPTIONS, downloadProgressStore, interruptedDownloadStore } from "@/lib/ui/synced-stores.svelte";
import { getCompatibleFilename, getOutputExtension, resolveAutoExtension } from "@/lib/utils/containers";
import {
  calculateWeightedProgress,
  findOriginalAudioFormat,
  formatAudioCodecLabel,
  formatVideoQualityLabel,
  getCurrentVideoAudioLanguage,
  normalizeLanguageCode,
  orderCaptionsByPreference,
  resolveCaptionLanguageMode,
  selectPreferredAudioFormat,
  waitForVideoElement
} from "@/lib/youtube/video-helpers";
import {
  AudioTrackLanguageMode,
  DownloadType,
  PanelTrackMode,
  VideoQualityMode,
  type AdaptiveFormatItem,
  type CaptionTrack,
  type VideoData
} from "@/types";
import { untrack } from "svelte";

const IS_WATCH_PAGE = location.pathname === "/watch";

// Prefer M4A (AAC) over WebM/Opus for music because M4A supports MJPEG cover art embedding.
function getPreferredMusicAudioFormat(audioFormats: AdaptiveFormatItem[]) {
  return audioFormats.find(format => format.mimeType.includes("mp4")) ?? audioFormats[0] ?? null;
}

export function createPanelState(getVideoData: () => VideoData) {
  // Download/progress state is derived directly from the shared store so the
  // panel is always in sync with the watch button and background without a
  // local mirror that can drift.
  const storeEntry = $derived(downloadProgressStore.get(getVideoData().videoId));
  const isDownloading = $derived(storeEntry?.isDownloading ?? false);
  const isDone = $derived(storeEntry?.isDone ?? false);
  const progress = $derived(storeEntry?.progress ?? 0);
  const progressType = $derived(storeEntry?.progressType ?? "");

  let downloadId = $state<number | null>(null);

  let downloadType = $state<DownloadType>(
    untrack(() => {
      const options = CONTENT_OPTIONS.value;
      const videoData = getVideoData();
      if (options.defaultDownloadType !== DownloadType.Auto) {
        return options.defaultDownloadType;
      }

      return videoData.isMusic ? DownloadType.Audio : DownloadType.VideoAndAudio;
    })
  );

  let selectedVideoFormat = $state<AdaptiveFormatItem | null>(untrack(() => getVideoData().videoFormats[0] ?? null));
  let selectedAudioFormat = $state<AdaptiveFormatItem | null>(
    untrack(() => {
      const videoData = getVideoData();
      if (videoData.isMusic) {
        return getPreferredMusicAudioFormat(videoData.audioFormats);
      }

      const options = CONTENT_OPTIONS.value;
      if (options.audioTrackLanguageMode === AudioTrackLanguageMode.MatchVideo && IS_WATCH_PAGE) {
        const currentLang = getCurrentVideoAudioLanguage();
        if (currentLang) {
          const matching = videoData.audioFormats.filter(
            format => format.audioTrack && normalizeLanguageCode(format.audioTrack.id) === currentLang
          );
          if (matching.length) {
            return matching.reduce((best, format) => format.bitrate > best.bitrate ? format : best);
          }
        }
      }

      return selectPreferredAudioFormat({
        audioFormats: videoData.audioFormats,
        videoMimeType: videoData.videoFormats[0]?.mimeType ?? "",
        languageMode: options.audioTrackLanguageMode,
        locale: document.documentElement.lang,
        browserLanguage: navigator.language,
        customLanguage: options.customLanguage
      });
    })
  );

  let panelAudioMode = $state<PanelTrackMode>(
    untrack(() => {
      const options = CONTENT_OPTIONS.value;
      if (options.audioTrackLanguageMode === AudioTrackLanguageMode.OriginalLanguage) {
        return PanelTrackMode.Original;
      }

      if (options.audioTrackLanguageMode === AudioTrackLanguageMode.Custom && options.customLanguage) {
        const langCode = normalizeLanguageCode(options.customLanguage);
        const hasMatch = getVideoData().audioFormats.some(
          format => format.audioTrack && normalizeLanguageCode(format.audioTrack.id) === langCode
        );
        if (hasMatch) {
          return PanelTrackMode.Custom;
        }
      }

      return PanelTrackMode.MatchVideo;
    })
  );

  let panelAudioCustomLanguage = $state(
    untrack(() => {
      const options = CONTENT_OPTIONS.value;
      if (options.audioTrackLanguageMode === AudioTrackLanguageMode.Custom && options.customLanguage) {
        const langCode = normalizeLanguageCode(options.customLanguage);
        const hasMatch = getVideoData().audioFormats.some(
          format => format.audioTrack && normalizeLanguageCode(format.audioTrack.id) === langCode
        );
        if (hasMatch) {
          return langCode;
        }
      }

      const firstTrack = getVideoData().audioFormats.find(format => format.audioTrack);
      return firstTrack?.audioTrack ? normalizeLanguageCode(firstTrack.audioTrack.id) : "";
    })
  );

  function getActivePlayerCaptionLanguage() {
    const elVideo = document.querySelector<HTMLVideoElement>("video.html5-main-video");
    if (!elVideo) {
      return null;
    }

    const activeTrack = Array.from(elVideo.textTracks).find(
      track =>
        track.mode !== "disabled"
        && (track.kind === "subtitles" || track.kind === "captions")
        && track.language
    );
    return activeTrack?.language ?? null;
  }

  let panelCaptionMode = $state<PanelTrackMode>(
    untrack(() => {
      const activeLang = getActivePlayerCaptionLanguage();
      if (activeLang) {
        const captionLang = normalizeLanguageCode(activeLang);
        const audioLang = selectedAudioFormat?.audioTrack
          ? normalizeLanguageCode(selectedAudioFormat.audioTrack.id)
          : null;
        if (captionLang !== audioLang) {
          return PanelTrackMode.Custom;
        }
      }

      const options = CONTENT_OPTIONS.value;
      const resolvedMode = resolveCaptionLanguageMode(options.captionLanguageMode, options.audioTrackLanguageMode);
      if (resolvedMode === AudioTrackLanguageMode.OriginalLanguage) {
        return PanelTrackMode.Original;
      }

      if (resolvedMode === AudioTrackLanguageMode.Custom && options.customLanguage) {
        const langCode = normalizeLanguageCode(options.customLanguage);
        const hasMatch = getVideoData().captionTracks.some(
          track => normalizeLanguageCode(track.languageCode) === langCode
        );
        if (hasMatch) {
          return PanelTrackMode.Custom;
        }
      }

      return PanelTrackMode.MatchVideo;
    })
  );

  let selectedCaptionTrack = $state<CaptionTrack | null>(
    untrack(() => {
      const videoData = getVideoData();
      if (!videoData.captionTracks.length) {
        return null;
      }

      const activeLang = getActivePlayerCaptionLanguage();
      if (activeLang) {
        const langCode = normalizeLanguageCode(activeLang);
        const match = videoData.captionTracks.find(track => normalizeLanguageCode(track.languageCode) === langCode);
        if (match) {
          return match;
        }
      }

      const options = CONTENT_OPTIONS.value;
      if (options.audioTrackLanguageMode === AudioTrackLanguageMode.Custom && options.customLanguage) {
        const langCode = normalizeLanguageCode(options.customLanguage);
        const match = videoData.captionTracks.find(track => normalizeLanguageCode(track.languageCode) === langCode);
        if (match) {
          return match;
        }
      }

      if (selectedAudioFormat?.audioTrack) {
        const langCode = normalizeLanguageCode(selectedAudioFormat.audioTrack.id);
        const match = videoData.captionTracks.find(track => normalizeLanguageCode(track.languageCode) === langCode);
        if (match) {
          return match;
        }
      }

      return orderCaptionsByPreference({
        captionTracks: videoData.captionTracks,
        languageMode: AudioTrackLanguageMode.MatchYouTube,
        locale: document.documentElement.lang,
        browserLanguage: navigator.language
      })[0] ?? null;
    })
  );
  let filename = $state(untrack(() => getCompatibleFilename(getVideoData().title || getVideoData().videoId)));
  let extension = $state(
    untrack(() => {
      const videoData = getVideoData();
      const options = CONTENT_OPTIONS.value;
      const extensionPreference = videoData.isMusic ? options.ext.audio : options.ext.video;
      const defaultFormat = videoData.isMusic
        ? getPreferredMusicAudioFormat(videoData.audioFormats)
        : videoData.videoFormats[0];
      return resolveAutoExtension({
        extension: extensionPreference,
        mimeType: defaultFormat?.mimeType ?? ""
      });
    })
  );
  let isFilenameValid = $state(true);

  const actualExtension = $derived.by(() => {
    if (downloadType === DownloadType.Audio) {
      return extension;
    }

    const isMissingFormats = !selectedVideoFormat || !selectedAudioFormat;
    if (isMissingFormats) {
      return extension;
    }

    const baseExtension = getOutputExtension({
      videoMimeType: selectedVideoFormat!.mimeType,
      audioMimeType: selectedAudioFormat!.mimeType,
      userExtension: extension
    });

    const selectedTrackId = selectedAudioFormat!.audioTrack?.id;
    if (selectedTrackId && CONTENT_OPTIONS.value.downloadExtras) {
      const hasExtraAudioTracks = getVideoData().audioFormats.some(
        format => format.audioTrack?.id && format.audioTrack.id !== selectedTrackId
      );
      if (hasExtraAudioTracks) {
        return "mkv";
      }
    }

    return baseExtension;
  });

  const isDownloadable = $derived(getVideoData().isDownloadable);
  const isInterrupted = $derived(!!interruptedDownloadStore.get(getVideoData().videoId));
  const isFailed = $derived(storeEntry?.isFailed === true);
  const primaryState = $derived.by<PrimaryButtonState>(() => {
    if (isDownloading) {
      return PrimaryButtonState.Downloading;
    }

    if (isFailed) {
      return PrimaryButtonState.Failed;
    }

    if (isInterrupted) {
      return PrimaryButtonState.Interrupted;
    }

    if (isDone) {
      return PrimaryButtonState.Done;
    }

    return PrimaryButtonState.Idle;
  });
  const displayProgress = $derived(
    calculateWeightedProgress({
      isDownloading,
      progress,
      progressType
    })
  );
  const fullFilename = $derived(getCompatibleFilename(`${filename}.${actualExtension}`));

  const qualityLabel = $derived.by(() => {
    if (downloadType === DownloadType.Audio) {
      return selectedAudioFormat
        ? `${Math.floor(selectedAudioFormat.bitrate / 1000)} kbps (${formatAudioCodecLabel(selectedAudioFormat.mimeType)})`
        : "";
    }

    return selectedVideoFormat ? formatVideoQualityLabel(selectedVideoFormat) : "";
  });

  $effect(() => {
    void crossWorldMessenger.sendMessage(CrossWorldMessage.FilenameChanged, {
      filename: fullFilename,
      quality: qualityLabel,
      videoItag: selectedVideoFormat?.itag,
      audioItag: selectedAudioFormat?.itag,
      audioTrackId: selectedAudioFormat?.audioTrack?.id
    });
  });

  async function matchVideoFormatToCurrentQuality(signal: AbortSignal) {
    const videoData = getVideoData();
    try {
      const elVideo = await waitForVideoElement(signal);
      if (document.getElementById("movie_player")?.classList.contains("ytp-ad-playing")) {
        selectedVideoFormat = videoData.videoFormats[0] ?? null;
        return;
      }

      const currentQuality = Math.min(elVideo.videoHeight, elVideo.videoWidth);
      selectedVideoFormat =
        videoData.videoFormats.find(format => Math.min(format.height ?? 0, format.width ?? 0) === currentQuality)
        ?? videoData.videoFormats[0]
        ?? null;
    } catch {
      selectedVideoFormat = videoData.videoFormats[0] ?? null;
    }
  }

  $effect(() => {
    const options = CONTENT_OPTIONS.value;
    const videoData = getVideoData();
    if (options.videoQualityMode === VideoQualityMode.CurrentQuality) {
      const abortController = new AbortController();
      void matchVideoFormatToCurrentQuality(abortController.signal);
      const elVideo = document.querySelector("video");
      function onCanPlay() {
        void matchVideoFormatToCurrentQuality(abortController.signal);
      }
      elVideo?.addEventListener("canplay", onCanPlay);
      return () => {
        abortController.abort();
        elVideo?.removeEventListener("canplay", onCanPlay);
      };
    }

    if (options.videoQualityMode === VideoQualityMode.Best) {
      selectedVideoFormat = videoData.videoFormats[0] ?? null;
      return;
    }

    selectedVideoFormat =
      videoData.videoFormats.find(format => format.height === options.videoQuality) ??
      videoData.videoFormats[0] ??
      null;
  });

  $effect(() => {
    const { videoId } = getVideoData();
    const existing = completedDownloadsStore.get(videoId);
    if (existing) {
      downloadId = existing.downloadId;
    }

    return completedDownloadsStore.subscribe((completedVideoId, completed) => {
      if (completedVideoId !== videoId) {
        return;
      }

      downloadId = completed.downloadId;
    });
  });

  $effect(() => crossWorldMessenger.onMessage(CrossWorldMessage.AudioTrackChanged, ({ data }) => {
    if (panelAudioMode !== PanelTrackMode.MatchVideo) {
      return;
    }

    const { audioFormats } = getVideoData();
    const langCode = normalizeLanguageCode(data.trackId.split(".")[0]);
    const matching = audioFormats.filter(
      format => format.audioTrack && normalizeLanguageCode(format.audioTrack.id) === langCode
    );
    if (!matching.length) {
      return;
    }

    selectedAudioFormat = matching.reduce((best, format) => format.bitrate > best.bitrate ? format : best);
  }));

  $effect(() => crossWorldMessenger.onMessage(CrossWorldMessage.CaptionTrackChanged, ({ data }) => {
    const { captionTracks } = getVideoData();
    const langCode = normalizeLanguageCode(data.languageCode);
    const match = captionTracks.find(track => normalizeLanguageCode(track.languageCode) === langCode);
    if (!match) {
      return;
    }

    // MatchVideo means "follow the player's caption selection" — stay in that mode and update.
    // Any other mode means the user had an explicit choice; treat the player change as an override.
    if (panelCaptionMode !== PanelTrackMode.MatchVideo) {
      panelCaptionMode = PanelTrackMode.Custom;
    }

    selectedCaptionTrack = match;
  }));

  // When a queued download (re)starts for this video, reset its progress
  // display locally so the panel shows 0% rather than stale prior progress.
  $effect(() => {
    const { videoId } = getVideoData();
    return videoQueueItem.watch(queue => {
      const currentQueue = queue ?? [];
      if (currentQueue[0]?.videoId !== videoId) {
        return;
      }

      downloadProgressStore.setLocal(videoId, {
        isDownloading: true,
        isDone: false,
        progress: 0,
        progressType: ""
      });
    });
  });

  function resetDoneState() {
    const { videoId } = getVideoData();
    const entry = storeEntry;
    if (!entry?.isDone) {
      return;
    }

    downloadProgressStore.setLocal(videoId, {
      ...entry,
      isDone: false
    });
  }

  function handleDownloadTypeChange(newType: DownloadType) {
    const options = CONTENT_OPTIONS.value;
    const { videoId } = getVideoData();
    // Clear progress display locally when the user picks a different type
    // so the panel shows idle rather than carrying over a stale done/in-progress state.
    downloadProgressStore.setLocal(videoId, {
      isDownloading: false,
      isDone: false,
      progress: 0,
      progressType: ""
    });
    downloadType = newType;
    const extensionPreference = newType === DownloadType.Audio ? options.ext.audio : options.ext.video;
    const format = newType === DownloadType.Audio ? selectedAudioFormat : selectedVideoFormat;
    extension = resolveAutoExtension({
      extension: extensionPreference,
      mimeType: format?.mimeType ?? ""
    });
  }

  function findMatchVideoAudioFormat(audioFormats: AdaptiveFormatItem[]) {
    return audioFormats.find(format => !format.audioTrack)
      ?? audioFormats.find(format => format.audioTrack?.audioIsDefault)
      ?? audioFormats[0]
      ?? null;
  }

  function applyAudioByLangCode(langCode: string) {
    const { audioFormats } = getVideoData();
    const matching = audioFormats.filter(
      format => format.audioTrack && normalizeLanguageCode(format.audioTrack.id) === langCode
    );
    if (matching.length) {
      selectedAudioFormat = matching.reduce((best, format) => format.bitrate > best.bitrate ? format : best);
      resetDoneState();
    }
  }

  function handlePanelAudioModeChange(newMode: PanelTrackMode) {
    panelAudioMode = newMode;

    if (newMode === PanelTrackMode.Original) {
      const { audioFormats } = getVideoData();
      const original = findOriginalAudioFormat(audioFormats);
      if (original) {
        selectedAudioFormat = original;
        resetDoneState();
      }

      return;
    }

    if (newMode === PanelTrackMode.Custom) {
      if (panelAudioCustomLanguage) {
        applyAudioByLangCode(panelAudioCustomLanguage);
      }

      return;
    }

    // MatchVideo: select whichever track YouTube chose for this session (audioIsDefault)
    const { audioFormats: matchAudioFormats } = getVideoData();
    const matchDefault = findMatchVideoAudioFormat(matchAudioFormats);
    if (matchDefault) {
      selectedAudioFormat = matchDefault;
      resetDoneState();
    }
  }

  function handlePanelAudioCustomChange(langCode: string) {
    panelAudioCustomLanguage = langCode;
    applyAudioByLangCode(langCode);
  }

  function handlePanelCaptionModeChange(newMode: PanelTrackMode) {
    panelCaptionMode = newMode;
    const { captionTracks } = getVideoData();
    if (newMode === PanelTrackMode.MatchVideo) {
      const activeLang = getActivePlayerCaptionLanguage();
      const normalizedActiveLang = activeLang ? normalizeLanguageCode(activeLang) : null;
      selectedCaptionTrack = normalizedActiveLang
        ? captionTracks.find(track => normalizeLanguageCode(track.languageCode) === normalizedActiveLang) ?? null
        : null;
      return;
    }

    if (newMode === PanelTrackMode.Original) {
      const { audioFormats } = getVideoData();
      const originalAudio = findOriginalAudioFormat(audioFormats);
      if (originalAudio?.audioTrack) {
        const langCode = normalizeLanguageCode(originalAudio.audioTrack.id);
        selectedCaptionTrack =
          captionTracks.find(track => normalizeLanguageCode(track.languageCode) === langCode) ?? null;
      } else {
        selectedCaptionTrack = captionTracks[0] ?? null;
      }

      return;
    }

    if (!selectedCaptionTrack && captionTracks.length > 0) {
      selectedCaptionTrack = captionTracks[0];
    }
  }

  function handleCaptionChange(track: CaptionTrack | null) {
    selectedCaptionTrack = track;
  }

  function startDownload() {
    const cannotStartDownload = isDownloading || !isDownloadable || !isFilenameValid || !selectedAudioFormat;
    if (cannotStartDownload) {
      return;
    }

    if (downloadType !== DownloadType.Audio && !selectedVideoFormat) {
      return;
    }

    const { videoId, sabrConfig } = getVideoData();
    downloadProgressStore.unsuppress(videoId);
    downloadProgressStore.set(videoId, {
      isDownloading: true,
      isDone: false,
      progress: 0,
      progressType: ""
    });

    void crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadRequest, {
      type: downloadType,
      videoId,
      videoItag: selectedVideoFormat?.itag ?? 0,
      audioItag: selectedAudioFormat!.itag,
      audioTrackId: selectedAudioFormat!.audioTrack?.id,
      selectedCaptionVssId: selectedCaptionTrack?.vssId,
      filenameOutput: fullFilename,
      sabrConfig
    });
  }

  async function cancelDownload() {
    const { videoId } = getVideoData();
    downloadProgressStore.delete(videoId);
    cancelStreamTransfer(videoId);
    void sendMessage(MessageType.CancelDownload, { videoIds: [videoId] });
    void crossWorldMessenger.sendMessage(CrossWorldMessage.CancelDownload, { videoIds: [videoId] });
    const currentProgress = await statusProgressItem.getValue();
    delete currentProgress[videoId];
    await statusProgressItem.setValue(currentProgress);
  }

  function resumeDownload() {
    startDownload();
  }

  async function discardInterrupted() {
    const { videoId } = getVideoData();
    interruptedDownloadStore.delete(videoId);
    downloadProgressStore.delete(videoId);
    await sendMessage(MessageType.ClearInterruptedDownload, { videoId });
  }

  function revealDownload() {
    if (downloadId === null) {
      return;
    }

    void sendMessage(MessageType.RevealDownloadFile, { downloadId });
  }

  return {
    get isDownloading() {
      return isDownloading;
    },
    get isDone() {
      return isDone;
    },
    get progress() {
      return progress;
    },
    get progressType() {
      return progressType;
    },
    get downloadType() {
      return downloadType;
    },
    get selectedVideoFormat() {
      return selectedVideoFormat;
    },
    get selectedAudioFormat() {
      return selectedAudioFormat;
    },
    get filename() {
      return filename;
    },
    set filename(value: string) {
      filename = value;
      resetDoneState();
    },
    get extension() {
      return extension;
    },
    set extension(value: string) {
      extension = value;
      resetDoneState();
    },
    get actualExtension() {
      return actualExtension;
    },
    get isDownloadable() {
      return isDownloadable;
    },
    get isInterrupted() {
      return isInterrupted;
    },
    get isFailed() {
      return isFailed;
    },
    get primaryState() {
      return primaryState;
    },
    get displayProgress() {
      return displayProgress;
    },
    get fullFilename() {
      return fullFilename;
    },
    get qualityLabel() {
      return qualityLabel;
    },
    get isFilenameValid() {
      return isFilenameValid;
    },
    set isFilenameValid(value: boolean) {
      isFilenameValid = value;
    },
    set selectedVideoFormat(value: AdaptiveFormatItem | null) {
      selectedVideoFormat = value;
      resetDoneState();
    },
    set selectedAudioFormat(value: AdaptiveFormatItem | null) {
      selectedAudioFormat = value;
      resetDoneState();
    },
    get downloadId() {
      return downloadId;
    },
    get panelAudioMode() {
      return panelAudioMode;
    },
    get panelAudioCustomLanguage() {
      return panelAudioCustomLanguage;
    },
    get panelCaptionMode() {
      return panelCaptionMode;
    },
    get selectedCaptionTrack() {
      return selectedCaptionTrack;
    },
    get isWatchPage() {
      return IS_WATCH_PAGE;
    },
    get downloadExtras() {
      return CONTENT_OPTIONS.value.downloadExtras;
    },
    handleDownloadTypeChange,
    handlePanelAudioModeChange,
    handlePanelAudioCustomChange,
    handlePanelCaptionModeChange,
    handleCaptionChange,
    startDownload,
    cancelDownload,
    resumeDownload,
    discardInterrupted,
    revealDownload
  };
}

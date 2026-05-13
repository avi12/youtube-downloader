import { findMatchVideoAudioFormat } from "./panel-audio-actions";
import {
  getActivePlayerCaption,
  IS_WATCH_PAGE,
  resolveInitialAudioCustomLanguage,
  resolveInitialAudioFormat,
  resolveInitialAudioMode,
  resolveInitialCaptionMode,
  resolveInitialCaptionTrack,
  resolveInitialDownloadType,
  resolveInitialExtension,
  resolveInitialFilename
} from "./panel-init";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { videoQueueItem } from "@/lib/storage/storage";
import { completedDownloadsStore } from "@/lib/ui/completed-downloads-store.svelte";
import { PrimaryButtonState } from "@/lib/ui/panel-button-attachments.svelte";
import { CONTENT_OPTIONS, downloadProgressStore, interruptedDownloadStore } from "@/lib/ui/synced-stores.svelte";
import { getCompatibleFilename, getOutputExtension, resolveAutoExtension } from "@/lib/utils/containers";
import {
  findOriginalAudioFormat,
  formatAudioCodecLabel,
  formatVideoQualityLabel,
  normalizeLanguageCode,
  calculateWeightedProgress,
  waitForVideoElement
} from "@/lib/youtube/video-helpers";
import {
  DownloadType,
  PanelTrackMode,
  VideoQualityMode,
  type AdaptiveFormatItem,
  type CaptionTrack,
  type VideoData
} from "@/types";
import { untrack } from "svelte";

export function createPanelState(getVideoData: () => VideoData) {
  const storeEntry = $derived(downloadProgressStore.get(getVideoData().videoId));
  const isDownloading = $derived(storeEntry?.isDownloading ?? false);
  const isDone = $derived(storeEntry?.isDone ?? false);
  const progress = $derived(storeEntry?.progress ?? 0);
  const progressType = $derived(storeEntry?.progressType ?? "");

  let downloadId = $state<number | null>(null);

  let downloadType = $state<DownloadType>(
    untrack(() => resolveInitialDownloadType(CONTENT_OPTIONS.value, getVideoData()))
  );

  let selectedVideoFormat = $state<AdaptiveFormatItem | null>(untrack(() => getVideoData().videoFormats[0] ?? null));
  let selectedAudioFormat = $state<AdaptiveFormatItem | null>(
    untrack(() => resolveInitialAudioFormat(CONTENT_OPTIONS.value, getVideoData()))
  );

  let panelAudioMode = $state<PanelTrackMode>(
    untrack(() => resolveInitialAudioMode(CONTENT_OPTIONS.value, getVideoData()))
  );

  let panelAudioCustomLanguage = $state(
    untrack(() => resolveInitialAudioCustomLanguage(CONTENT_OPTIONS.value, getVideoData()))
  );

  let panelCaptionMode = $state<PanelTrackMode>(
    untrack(() => resolveInitialCaptionMode(CONTENT_OPTIONS.value, getVideoData()))
  );

  let selectedCaptionTrack = $state<CaptionTrack | null>(
    untrack(() => resolveInitialCaptionTrack(panelCaptionMode, CONTENT_OPTIONS.value, getVideoData()))
  );

  let filename = $state(untrack(() => resolveInitialFilename(getVideoData())));
  let extension = $state(
    untrack(() => resolveInitialExtension(CONTENT_OPTIONS.value, getVideoData()))
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
  const isFailed = $derived(!!storeEntry?.isFailed);
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
    if (panelCaptionMode !== PanelTrackMode.MatchVideo) {
      return;
    }

    const { captionTracks } = getVideoData();
    const match = captionTracks.find(track => track.vssId === data.vssId)
      ?? captionTracks.find(
        track => normalizeLanguageCode(track.languageCode) === normalizeLanguageCode(data.languageCode)
      );
    if (!match) {
      return;
    }

    selectedCaptionTrack = match;
  }));

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
      const activeCaption = getActivePlayerCaption();
      selectedCaptionTrack = activeCaption
        ? captionTracks.find(track => track.vssId === activeCaption.vss_id)
          ?? captionTracks.find(
            track => normalizeLanguageCode(track.languageCode) === normalizeLanguageCode(activeCaption.languageCode)
          )
          ?? null
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

  function cancelDownload() {
    const { videoId } = getVideoData();
    void crossWorldMessenger.sendMessage(CrossWorldMessage.CancelDownload, { videoIds: [videoId] });
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

<script lang="ts">
  /**
   * Playlist-level download button.
   * Appears in the playlist header and allows downloading all checked videos.
   */
  import { MessageType, sendMessage } from "../lib/messaging";
  import { applyPolymerCustomStyles, PAPER_PROGRESS_THEME } from "../lib/polymer-utils";
  import { musicListItem, videoOnlyListItem, videoQueueItem } from "../lib/storage";
  import { playlistMetadataSignal } from "../lib/synced-stores.svelte";
  import { videoDataStore } from "../lib/synced-stores.svelte";
  import { getCompatibleFilename, resolveAutoExtension } from "../lib/utils";
  import type { DownloadType, Options, VideoData } from "../types";
  import { SvelteMap } from "svelte/reactivity";

  type Props = {
    options: Options;
  };

  const { options }: Props = $props();

  // Map of videoId to VideoData for all videos that have been fetched
  const videoDataMap = new SvelteMap<string, VideoData>();
  let checkedVideoIds = $state<Set<string>>(new Set());
  let isDownloading = $state(false);
  let downloadedCount = $state(0);
  let totalCount = $state(0);
  let error = $state("");

  // Collect video data as each playlist item reports in
  // Reactively sync video data from the synced store
  $effect(() => {
    for (const videoId of videoDataStore.keys()) {
      const data = videoDataStore.get(videoId);
      if (data && !videoDataMap.has(videoId)) {
        videoDataMap.set(videoId, data);
      }
    }
  });

  // Track checkboxes for per-video selection
  function handleCheckboxChange(e: Event) {
    if (!(e.target instanceof HTMLInputElement)) {
      return;
    }

    const elTarget = e.target;
    if (!elTarget.matches("[data-ytdl-checkbox]")) {
      return;
    }

    const videoId = elTarget.dataset.videoId ?? "";
    if (!videoId) {
      return;
    }

    if (elTarget.checked) {
      checkedVideoIds = new Set([...checkedVideoIds, videoId]);
    } else {
      checkedVideoIds = new Set([...checkedVideoIds].filter(id => id !== videoId));
    }
  }

  $effect(() => {
    document.addEventListener("change", handleCheckboxChange);
    return () => document.removeEventListener("change", handleCheckboxChange);
  });

  const downloadableVideos = $derived(
    [...videoDataMap.values()].filter(data => data.isDownloadable)
  );

  const checkedDownloadableVideos = $derived(
    checkedVideoIds.size === 0
      ? downloadableVideos
      : downloadableVideos.filter(data => checkedVideoIds.has(data.videoId))
  );

  const downloadButtonLabel = $derived.by(() => {
    if (isDownloading) {
      return `Downloading ${downloadedCount}/${totalCount}`;
    }

    const count = checkedDownloadableVideos.length;
    if (count === 0) {
      return "No downloadable videos";
    }

    return `Download ${count} video${count === 1 ? "" : "s"}`;
  });

  async function startPlaylistDownload() {
    if (checkedDownloadableVideos.length === 0) {
      return;
    }

    error = "";
    isDownloading = true;
    totalCount = checkedDownloadableVideos.length;
    downloadedCount = 0;

    const metadata = playlistMetadataSignal.value;
    const playlistTitle = metadata?.playlistTitle || "Playlist";
    const playlistId = metadata?.playlistId || `playlist-${Date.now()}`;

    const downloadRequests = checkedDownloadableVideos.map(data => {
      let downloadType: DownloadType = data.isMusic ? "audio" : "video+audio";
      if (options.defaultDownloadType !== "auto") {
        downloadType = options.defaultDownloadType;
      }

      const extPref = data.isMusic ? options.ext.audio : options.ext.video;
      const defaultFormat = data.isMusic ? data.audioFormats[0] : data.videoFormats[0];
      const extension = resolveAutoExtension(extPref, defaultFormat?.mimeType ?? "", data.isMusic ? "audio" : "video");
      const filenameOutput = getCompatibleFilename(`${data.title}.${extension}`);

      return {
        type: downloadType,
        videoId: data.videoId,
        videoItag: data.videoFormats[0]?.itag ?? 0,
        audioItag: data.audioFormats[0]?.itag ?? 0,
        filenameOutput,
        sabrConfig: data.sabrConfig,
        playlistId,
        playlistTitle,
        playlistTotalCount: checkedDownloadableVideos.length
      };
    });

    try {
      await sendMessage(MessageType.RequestPlaylistDownload, {
        items: downloadRequests,
        playlistTitle,
        isZipBundle: true
      });
    } catch {
      error = "Failed to start downloads - please try again";
      isDownloading = false;
      return;
    }

    // Track completion via storage changes
    let stopWatching: (() => void) | null = null;

    async function checkCompletion() {
      const [queueValues, musicValues, videoOnlyValues] = await Promise.all([
        videoQueueItem.getValue(),
        musicListItem.getValue(),
        videoOnlyListItem.getValue()
      ]);

      const remaining = downloadRequests.filter(
        request =>
          queueValues.some(item => item.videoId === request.videoId) ||
          musicValues.includes(request.videoId) ||
          videoOnlyValues.includes(request.videoId)
      ).length;

      downloadedCount = totalCount - remaining;

      if (remaining === 0) {
        isDownloading = false;
        stopWatching?.();
        stopWatching = null;
      }
    }

    const unwatches = [
      videoQueueItem.watch(() => checkCompletion()),
      musicListItem.watch(() => checkCompletion()),
      videoOnlyListItem.watch(() => checkCompletion())
    ];
    stopWatching = () => {
      for (const unwatch of unwatches) {
        unwatch();
      }
    };
  }

  async function cancelPlaylistDownload() {
    const videoIds = checkedDownloadableVideos.map(data => data.videoId);
    await sendMessage(MessageType.CancelDownload, { videoIds });
    isDownloading = false;
    downloadedCount = 0;
  }

  function handleDownloadClick() {
    if (isDownloading) {
      void cancelPlaylistDownload();
    } else {
      void startPlaylistDownload();
    }
  }

  function attachPlaylistButton(element: Element) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    element.addEventListener("click", handleDownloadClick);
    element.dispatchEvent(new CustomEvent("ytdl:set-yt-button-data", {
      detail: {
        iconName: isDownloading ? "CLOSE" : "DOWNLOAD",
        title: downloadButtonLabel,
        accessibilityText: downloadButtonLabel,
        style: "MONO",
        type: "TONAL",
        buttonSize: "DEFAULT",
        state: checkedDownloadableVideos.length === 0 && !isDownloading ? "DISABLED" : "ACTIVE",
        isFullWidth: false,
        isDisabled: checkedDownloadableVideos.length === 0 && !isDownloading,
        tooltip: downloadButtonLabel
      },
      bubbles: true
    }));
  }

  function attachPlaylistProgress(element: Element) {
    applyPolymerCustomStyles(element, PAPER_PROGRESS_THEME);
  }
</script>

<div class="ytdl-playlist-container" aria-label="Playlist Downloader" role="region">
  {#if error}
    <div class="ytdl-error-banner" role="alert">{error}</div>
  {/if}

  <div class="ytdl-playlist-actions">
    <yt-button-view-model {@attach attachPlaylistButton}
    ></yt-button-view-model>

    {#if isDownloading && totalCount > 0}
      <tp-yt-paper-progress
        {@attach attachPlaylistProgress}
        max={totalCount}
        value={downloadedCount}
      ></tp-yt-paper-progress>
    {/if}
  </div>

  {#if downloadableVideos.length < videoDataMap.size}
    <p class="ytdl-restriction-notice" role="status">
      {videoDataMap.size - downloadableVideos.length} video{videoDataMap.size -
        downloadableVideos.length === 1
        ? ""
        : "s"} not downloadable (private or restricted)
    </p>
  {/if}
</div>

<style>
  .ytdl-playlist-container {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 0;
  }

  .ytdl-playlist-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .ytdl-error-banner {
    padding: 8px 12px;
    border-radius: 4px;
    background: var(--yt-spec-error-indicator, rgb(204 0 0));
    color: #ffffff;
    font-size: 1.3rem;
  }

  .ytdl-restriction-notice {
    margin: 0;
    font-size: 1.2rem;
  }
</style>

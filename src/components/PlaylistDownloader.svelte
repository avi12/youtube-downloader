<script lang="ts">
  /**
   * Playlist-level download button.
   * Appears in the playlist header and allows downloading all checked videos.
   */
  import { sendMessage } from "../lib/messaging";
  import { musicListItem, videoOnlyListItem, videoQueueItem } from "../lib/storage";
  import { getCompatibleFilename } from "../lib/utils";
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
  // Collect video data as each item resolves (same isolated world)
  $effect(() => {
    function handleVideoData(e: Event) {
      if (!(e instanceof CustomEvent)) {
        return;
      }

      videoDataMap.set(e.detail.videoId, e.detail);
    }

    document.addEventListener("ytdl:video-data-received", handleVideoData);

    return () => document.removeEventListener("ytdl:video-data-received", handleVideoData);
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

  const downloadButtonLabel = $derived(() => {
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

    const playlistTitle = document.querySelector(
      "yt-dynamic-text-view-model .yt-core-attributed-string, h1#title"
    )?.textContent?.trim() ?? "Playlist";

    const playlistId = new URLSearchParams(location.search).get("list") ?? `playlist-${Date.now()}`;

    const downloadRequests = checkedDownloadableVideos.map(data => {
      const downloadType: DownloadType = data.isMusic ? "audio" : "video+audio";
      const extension = data.isMusic ? options.ext.audio : options.ext.video;
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
      await sendMessage("requestPlaylistDownload", {
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
    await sendMessage("cancelDownload", { videoIds });
    isDownloading = false;
    downloadedCount = 0;
  }

  function handleDownloadClick() {
    if (isDownloading) {
      cancelPlaylistDownload();
    } else {
      startPlaylistDownload();
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
        title: downloadButtonLabel(),
        accessibilityText: downloadButtonLabel(),
        style: "MONO",
        type: "TONAL",
        buttonSize: "DEFAULT",
        state: checkedDownloadableVideos.length === 0 && !isDownloading ? "DISABLED" : "ACTIVE",
        isFullWidth: false,
        isDisabled: checkedDownloadableVideos.length === 0 && !isDownloading,
        tooltip: downloadButtonLabel()
      },
      bubbles: true
    }));
  }

  function attachPlaylistProgress(element: Element) {
    if (!("updateStyles" in element) || typeof element.updateStyles !== "function") {
      return;
    }

    element.updateStyles({
      "--paper-progress-active-color": "var(--yt-spec-call-to-action, rgb(62 166 255))",
      "--paper-progress-container-color": "transparent"
    });
  }
</script>

<div
  style="display: flex; flex-direction: column; gap: 8px; padding: 12px 0"
  aria-label="Playlist Downloader"
  role="region"
>
  {#if error}
    <div
      style:padding="8px 12px"
      style:border-radius="4px"
      style:background="var(--yt-spec-error-indicator, rgb(204 0 0))"
      style:color="#fff"
      style:font-size="1.3rem"
      role="alert"
    >{error}</div>
  {/if}

  <div style="display: flex; flex-direction: column; gap: 8px">
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
    <p style="margin: 0; font-size: 1.2rem" role="status">
      {videoDataMap.size - downloadableVideos.length} video{videoDataMap.size -
        downloadableVideos.length === 1
        ? ""
        : "s"} not downloadable (private or restricted)
    </p>
  {/if}
</div>

<script lang="ts">
  import { sendMessage } from "../lib/messaging";
  import { videoQueueItem } from "../lib/storage";
  import { getCompatibleFilename, waitForVideoElement } from "../lib/utils";
  import type {
    AdaptiveFormatItem,
    DownloadType,
    Options,
    ProgressType,
    VideoData
  } from "../types";
  import DownloadOptions from "./DownloadOptions.svelte";
  import { untrack } from "svelte";

  // YouTube's native button class strings - injected into the shadow root at mount time
  const ytButtonBase = "yt-spec-button-shape-next yt-spec-button-shape-next--tonal"
    + " yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-m";
  const ytButtonWithText = `${ytButtonBase} yt-spec-button-shape-next--icon-leading action-button`;
  const ytButtonIconOnly = `${ytButtonBase} yt-spec-button-shape-next--icon-button action-button`;

  type Props = {
    videoData: VideoData;
    options: Options;
  };

  const { videoData, options }: Props = $props();

  // -- Download state ---------------------------------------------------------

  let isDownloading = $state(false);
  let isDone = $state(false);
  let isQueued = $state(false);
  const isPortDisconnected = $state(false);
  let progress = $state(0);
  let progressType = $state<ProgressType | "">("");
  let showOptions = $state(false);
  let downloadWrapperStyle = $state("");
  let optionsWrapperStyle = $state("");

  // -- Format selection (initialized from props, not reactive to prop changes) -

  let downloadType = $state<DownloadType>(untrack(() => videoData.isMusic ? "audio" : "video+audio"));
  let selectedVideoFormat = $state<AdaptiveFormatItem | null>(untrack(() => videoData.videoFormats[0] ?? null));
  let selectedAudioFormat = $state<AdaptiveFormatItem | null>(untrack(() => videoData.audioFormats[0] ?? null));
  let filename = $state(untrack(() => videoData.title));
  let extension = $state(untrack(() => videoData.isMusic ? options.ext.audio : options.ext.video));

  // -- Derived state ----------------------------------------------------------

  const isDownloadable = $derived(
    videoData.isDownloadable && !isPortDisconnected
  );

  const buttonLabel = $derived(() => {
    if (isPortDisconnected) {
      return "Reload to download";
    }

    if (!isDownloadable) {
      return "Not downloadable";
    }

    if (isDone && (progressType === "ffmpeg" || downloadType !== "video+audio")) {
      return "Done";
    }

    if (isQueued) {
      return "Queued";
    }

    if (isDownloading) {
      return "Cancel";
    }

    return "Download";
  });

  const progressTooltip = $derived(() => {
    const percentage = (progress * 100).toFixed(1);
    if (downloadType !== "video+audio") {
      return `${percentage}% (downloading ${downloadType}-only)`;
    }

    if (progressType === "ffmpeg") {
      return `${percentage}% (stitching video & audio)`;
    }

    return `${percentage}% (downloading ${progressType || "video"})`;
  });

  const showProgress = $derived(
    isDownloading && progress > 0 && progress < 1
  );

  const tooltipText = $derived(() => {
    if (!isDownloadable || isDone) {
      return "";
    }

    const compatibleName = getCompatibleFilename(`${filename}.${extension}`);
    if (showProgress) {
      return `${compatibleName} - ${(progress * 100).toFixed(1)}%`;
    }

    return compatibleName;
  });

  // Notify the MAIN world download button tooltip when filename changes
  $effect(() => {
    const fullFilename = getCompatibleFilename(`${filename}.${extension}`);
    document.dispatchEvent(
      new CustomEvent("ytdl:filename-changed", { detail: { filename: fullFilename } })
    );
  });

  // -- Video quality matching -------------------------------------------------

  async function matchVideoFormatToCurrentQuality() {
    try {
      const elVideo = await waitForVideoElement();
      const currentQuality = Math.min(elVideo.videoHeight, elVideo.videoWidth);
      const matchedFormat =
        videoData.videoFormats.find(
          format =>
            Math.min(format.height ?? 0, format.width ?? 0) === currentQuality
        ) ?? videoData.videoFormats[0];
      selectedVideoFormat = matchedFormat ?? null;
    } catch {
      selectedVideoFormat = videoData.videoFormats[0] ?? null;
    }
  }

  function handleCanPlay() {
    matchVideoFormatToCurrentQuality();
  }

  $effect(() => {
    if (options.videoQualityMode === "current-quality") {
      matchVideoFormatToCurrentQuality();
      // Re-match when video quality changes (user changes quality in YouTube player)
      document.querySelector("video")?.addEventListener("canplay", handleCanPlay);
      return () => {
        document
          .querySelector("video")
          ?.removeEventListener("canplay", handleCanPlay);
      };
    }

    if (options.videoQualityMode === "best") {
      selectedVideoFormat = videoData.videoFormats[0] ?? null;
      return;
    }

    const targetQuality = options.videoQuality;
    selectedVideoFormat =
      videoData.videoFormats.find(
        format =>
          Math.min(format.height ?? 0, format.width ?? 0) === targetQuality
      ) ?? videoData.videoFormats[0] ?? null;
  });

  // -- Progress updates -------------------------------------------------------

  function handleProgress(e: Event) {
    if (!(e instanceof CustomEvent)) {
      return;
    }

    const {
      videoId, progress: newProgress, progressType: newProgressType, isRemoved
    }: {
      videoId: string;
      progress: number;
      progressType: ProgressType;
      isRemoved?: boolean;
    } = e.detail;
    if (videoId !== videoData.videoId) {
      return;
    }

    if (isRemoved) {
      progress = 0;
      progressType = downloadType === "video+audio" ? "" : downloadType;
      isDownloading = false;
      isDone = false;
      isQueued = false;
      return;
    }

    progress = newProgress;
    progressType = newProgressType;
    isDone = newProgress >= 1;
  }

  $effect(() => {
    document.addEventListener("ytdl:progress", handleProgress);
    return () => document.removeEventListener("ytdl:progress", handleProgress);
  });

  // Track queue position via storage
  function handleQueueChange(queue: { videoId: string }[] | null) {
    const currentQueue = queue ?? [];
    const isInQueue = currentQueue.some(item => item.videoId === videoData.videoId);
    const isCurrentlyDownloading = currentQueue[0]?.videoId === videoData.videoId;

    isQueued = isInQueue && !isCurrentlyDownloading;

    if (isCurrentlyDownloading) {
      progress = 0;
      progressType = "";
    }
  }

  $effect(() => videoQueueItem.watch(handleQueueChange));

  // -- Download actions -------------------------------------------------------

  function handleDownloadTypeChange(newType: DownloadType) {
    isDownloading = false;
    progress = 0;
    downloadType = newType;
    extension = newType === "audio" ? options.ext.audio : options.ext.video;
  }

  async function toggleDownload() {
    isDone = false;
    isDownloading = !isDownloading;

    if (downloadType === "video+audio") {
      progressType = "";
    }

    progress = 0;

    if (!isDownloading || isQueued) {
      await sendMessage("cancelDownload", { videoIds: [videoData.videoId] });
      return;
    }

    await startDownload();
  }

  async function startDownload() {
    if (!isDownloadable) {
      return;
    }

    if (downloadType !== "audio" && !selectedVideoFormat) {
      return;
    }

    if (!selectedAudioFormat) {
      return;
    }

    const filenameOutput = getCompatibleFilename(`${filename}.${extension}`);

    document.dispatchEvent(new CustomEvent("ytdl:download-request", {
      detail: {
        type: downloadType,
        videoId: videoData.videoId,
        videoItag: selectedVideoFormat?.itag ?? 0,
        audioItag: selectedAudioFormat.itag,
        filenameOutput,
        sabrConfig: videoData.sabrConfig!
      }
    }));
  }

  function computeWrapperTooltipStyle(e: MouseEvent) {
    if (!(e.currentTarget instanceof HTMLElement)) {
      return "";
    }

    const { left, width, top } = e.currentTarget.getBoundingClientRect();
    return `--tooltip-x: ${left + width / 2}px; --tooltip-y: ${top}px;`;
  }

  function handleDownloadMouseEnter(e: MouseEvent) {
    downloadWrapperStyle = computeWrapperTooltipStyle(e);
  }

  function handleOptionsMouseEnter(e: MouseEvent) {
    optionsWrapperStyle = computeWrapperTooltipStyle(e);
  }

  // -- SVG icon paths ---------------------------------------------------------

  const iconPaths = {
    download:
      "M17 18V19H6V18H17ZM16.5 11.4L15.8 10.7L12 14.4V4H11V14.4L7.2 10.6L6.5 11.3L11.5 16.3L16.5 11.4Z",
    cancel:
      "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z",
    done: "M20.13,5.41 18.72,4 9.53,13.19 5.28,8.95 3.87,10.36 9.53,16.02M5 18h14v2H5z",
    expand:
      "M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z",
    collapse:
      "M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z",
    unavailable:
      "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"
  } as const;

  const currentIconPath = $derived(() => {
    if (!isDownloadable) {
      return iconPaths.unavailable;
    }

    if (isDone) {
      return iconPaths.done;
    }

    if (isDownloading) {
      return iconPaths.cancel;
    }

    return iconPaths.download;
  });
</script>

<section
  class="video-downloader"
  aria-label="YouTube Downloader"
>
  <div class="action-buttons">
    <!-- Main download/cancel button -->
    <div
      style={downloadWrapperStyle}
      class="tooltip-wrapper"
      onmouseenter={handleDownloadMouseEnter}
    >
      {#if !showOptions}
        <button
          class="{ytButtonWithText}"
          class:action-button--disabled={!isDownloadable}
          class:action-button--done={isDone}
          aria-busy={isDownloading && !isDone}
          aria-label={buttonLabel()}
          disabled={showOptions || !isDownloadable}
          onclick={toggleDownload}
        >
          <span class="yt-spec-button-shape-next__icon" aria-hidden="true">
            <svg fill="currentColor" focusable="false" height="24" width="24">
              <path d={currentIconPath()} />
            </svg>
          </span>
          <span class="yt-spec-button-shape-next__button-text-content">{buttonLabel()}</span>
        </button>
      {:else}
        <button
          class="{ytButtonWithText} action-button--disabled"
          aria-label="Download (close options first)"
          disabled
        >
          <span class="yt-spec-button-shape-next__icon" aria-hidden="true">
            <svg fill="currentColor" focusable="false" height="24" width="24">
              <path d={iconPaths.download} />
            </svg>
          </span>
          <span class="yt-spec-button-shape-next__button-text-content">Download</span>
        </button>
      {/if}
      <span class="yt-tooltip" role="tooltip">{tooltipText()}</span>
    </div>

    <!-- Options toggle button -->
    {#if isDownloadable}
      <div
        style={optionsWrapperStyle}
        class="tooltip-wrapper"
        onmouseenter={handleOptionsMouseEnter}
      >
        <button
          class="{ytButtonIconOnly}"
          aria-expanded={showOptions}
          aria-label={showOptions ? "Close options" : "More download options"}
          disabled={isDownloading}
          onclick={() => (showOptions = !showOptions)}
        >
          <span class="yt-spec-button-shape-next__icon" aria-hidden="true">
            <svg fill="currentColor" focusable="false" height="24" width="24">
              <path d={showOptions ? iconPaths.collapse : iconPaths.expand} />
            </svg>
          </span>
        </button>
        <span class="yt-tooltip" role="tooltip">
          {showOptions ? "Close options" : "More options"}
        </span>
      </div>
    {/if}
  </div>

  <!-- Progress bar -->
  {#if showProgress}
    <div class="progress-wrapper" aria-label={progressTooltip()}>
      <progress
        aria-valuemax={1}
        aria-valuemin={0}
        aria-valuenow={progress}
        aria-valuetext={progressTooltip()}
        max={1}
        value={progress}
      ></progress>
      <span class="progress-tooltip" aria-atomic="true" aria-live="polite">
        {progressTooltip()}
      </span>
    </div>
  {/if}

  <!-- Options panel -->
  {#if showOptions}
    <div class="options-panel" aria-label="Download options" role="dialog">
      <DownloadOptions
        audioFormats={videoData.audioFormats}
        {downloadType}
        {extension}
        {filename}
        {isDownloading}
        onaudioformatchange={format => (selectedAudioFormat = format)}
        ondownloadtypechange={handleDownloadTypeChange}
        onextensionchange={newExtension => (extension = newExtension)}
        onfilenamechange={newFilename => (filename = newFilename)}
        onvideoformatchange={format => (selectedVideoFormat = format)}
        {selectedAudioFormat}
        {selectedVideoFormat}
        videoFormats={videoData.videoFormats}
      />

      <!-- Download button inside options panel -->
      <div class="options-download-row">
        <button
          class="options-download-button"
          disabled={!isDownloadable}
          onclick={toggleDownload}
        >
          {#if isDownloading && progress > 0 && progress < 1}
            <span
              style="--fill-scale: {progress};"
              class="options-download-progress"
            ></span>
          {/if}
          <span class="options-download-label">{buttonLabel()}</span>
        </button>
      </div>
    </div>
  {/if}
</section>

<style>
  :global(body) {
    margin: 0;
  }

  :host {
    display: contents;
  }

  /* -- YouTube button system (embedded to match native UI) -------------------- */

  :global(.yt-spec-button-shape-next) {
    position: relative;
    display: flex;
    flex: 1 1 1e-09px;
    flex-direction: row;
    justify-content: center;
    align-items: center;
    box-sizing: border-box;
    min-width: 0;
    margin: 0;
    border: none;
    background: none;
    outline-width: 0;
    font-family: Roboto, Arial, sans-serif;
    font-weight: 500;
    font-size: 1.4rem;
    line-height: 1.3;
    text-decoration: none;
    text-transform: none;
    white-space: nowrap;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  :global(.yt-spec-button-shape-next__icon) {
    fill: currentColor;
    line-height: 0;
  }

  :global(.yt-spec-button-shape-next__button-text-content) {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  :global(.yt-spec-button-shape-next--icon-button) {
    flex: 0 0 auto;
  }

  :global(.yt-spec-button-shape-next--size-m) {
    height: 36px;
    padding: 0 16px;
    border-radius: 18px;
    font-size: 1.4rem;
    line-height: 2.571;
  }

  :global(.yt-spec-button-shape-next--size-m .yt-spec-button-shape-next__icon) {
    width: 24px;
    height: 24px;
  }

  :global(.yt-spec-button-shape-next--size-m.yt-spec-button-shape-next--icon-button) {
    width: 36px;
    padding: 0;
  }

  :global(
    .yt-spec-button-shape-next--size-m.yt-spec-button-shape-next--icon-leading .yt-spec-button-shape-next__icon
  ) {
    margin-right: 6px;
    margin-left: -6px;
  }

  :global(.yt-spec-button-shape-next--mono.yt-spec-button-shape-next--tonal) {
    background: color-mix(in sRGB, var(--yt-spec-text-primary, rgb(15 15 15)) 10%, transparent);
    color: var(--yt-spec-text-primary, rgb(15 15 15));
  }

  :global(.yt-spec-button-shape-next--mono.yt-spec-button-shape-next--tonal:hover) {
    background: color-mix(in sRGB, var(--yt-spec-text-primary, rgb(15 15 15)) 18%, transparent);
  }

  .video-downloader {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    margin: 0 8px;
  }

  .action-buttons {
    display: flex;
    gap: 2px;
    align-items: center;
  }

  .tooltip-wrapper {
    position: relative;
    display: flex;
  }

  /* YouTube tp-yt-paper-tooltip style - position: fixed escapes overflow-y: hidden on ytd-menu-renderer */
  .yt-tooltip {
    position: fixed;
    top: var(--tooltip-y, 0);
    left: var(--tooltip-x, 0);
    z-index: 1002;
    padding: 8px;
    border-radius: 2px;
    background-color: var(--paper-tooltip-background, rgb(97 97 97));
    color: var(--paper-tooltip-text-color, rgb(255 255 255));
    font-family: Roboto, Noto, sans-serif;
    font-size: 1rem;
    line-height: 1;
    white-space: nowrap;
    opacity: 0%;
    pointer-events: none;
    user-select: none;
    transition: opacity 150ms;
    transform: translateX(-50%) translateY(calc(-100% - 8px));
  }

  .tooltip-wrapper:hover .yt-tooltip {
    opacity: 100%;
  }

  /* Override YouTube's flex: 1 so buttons don't stretch */
  .action-button {
    flex: 0 0 auto;
  }

  .action-button:disabled,
  .action-button--disabled {
    opacity: 40%;
    cursor: default;
  }

  .action-button--done {
    color: var(--yt-spec-brand-icon-active, rgb(6 95 212));
  }

  /* Progress bar */
  .progress-wrapper {
    position: absolute;
    top: 100%;
    right: 0;
    left: 0;
    margin-top: 2px;
  }

  progress {
    appearance: none;
    overflow: hidden;
    width: 100%;
    height: 3px;
    border: none;
    border-radius: 2px;
    background-color: var(--yt-spec-10-percent-layer, rgb(0 0 0 / 10%));
  }

  progress::-webkit-progress-bar {
    border-radius: 2px;
    background-color: var(--yt-spec-10-percent-layer, rgb(0 0 0 / 10%));
  }

  progress::-webkit-progress-value {
    border-radius: 2px;
    background-color: var(--yt-spec-brand-icon-active, rgb(255 0 0));
  }

  progress::-moz-progress-bar {
    border-radius: 2px;
    background-color: var(--yt-spec-brand-icon-active, rgb(255 0 0));
  }

  .progress-tooltip {
    display: block;
    margin-top: 2px;
    color: var(--yt-spec-text-secondary, rgb(96 96 96));
    font-family: Roboto, Arial, sans-serif;
    font-size: 1.1rem;
    text-align: center;
  }

  /* Options panel */
  .options-panel {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    z-index: 1000;
    min-width: 300px;
    border: 1px solid var(--yt-spec-10-percent-layer, rgb(0 0 0 / 10%));
    border-radius: 4px;
    background: var(--yt-spec-general-background-a, rgb(255 255 255));
    box-shadow: 0 4px 16px rgb(0 0 0 / 20%);
  }

  .options-download-row {
    padding-block: 8px 12px;
    padding-inline: 12px;
  }

  .options-download-button {
    position: relative;
    overflow: hidden;
    width: 100%;
    padding: 8px 16px;
    border: none;
    border-radius: 2px;
    background: var(--yt-spec-brand-button-background, rgb(6 95 212));
    color: rgb(255 255 255);
    font-family: Roboto, Arial, sans-serif;
    font-weight: 500;
    font-size: 1.4rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background-color 150ms;
  }

  .options-download-button:disabled {
    opacity: 50%;
    cursor: default;
  }

  .options-download-button:hover:not(:disabled) {
    background: var(--yt-spec-brand-button-background-hover, rgb(3 86 196));
  }

  .options-download-progress {
    --fill-scale: 0;

    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgb(255 255 255 / 30%);
    transition: transform 200ms;
    transform: scaleX(var(--fill-scale));
    transform-origin: left;
  }

  .options-download-label {
    position: relative;
    z-index: 1;
  }

  /* Dark mode */
  @media (prefers-color-scheme: dark) {
    .yt-tooltip {
      background: rgb(255 255 255 / 15%);
    }
  }
</style>

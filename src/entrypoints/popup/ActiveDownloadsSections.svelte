<script lang="ts">
  import DownloadItem from "./DownloadItem.svelte";
  import DownloadSection from "./DownloadSection.svelte";
  import { ProgressType } from "@/types";
  import type { VideoQueueItem } from "@/types";

  interface Props {
    isFFmpegReady: boolean;
    videoDownloads: VideoQueueItem[];
    musicList: string[];
    videoOnlyList: string[];
    videoDetails: Record<string, {
      filenameOutput: string;
      quality?: string;
    }>;
    statusProgress: Record<string, {
      progress: number;
      progressType: ProgressType;
    }>;
    percentFormatter: Intl.NumberFormat;
    onCancel: (videoIds: string[]) => void;
  }

  const {
    isFFmpegReady,
    videoDownloads,
    musicList,
    videoOnlyList,
    videoDetails,
    statusProgress,
    percentFormatter,
    onCancel
  }: Props = $props();

  const videoDownloadIds = $derived(videoDownloads.map(item => item.videoId));

  function getProgressLabel(videoId: string) {
    const prog = statusProgress[videoId];
    if (!prog) {
      return "";
    }

    const percentage = percentFormatter.format(prog.progress);
    if (prog.progressType === ProgressType.FFmpeg) {
      return `${percentage} stitching`;
    }

    return `${percentage} (${prog.progressType})`;
  }

  function getProgress(videoId: string) {
    return statusProgress[videoId]?.progress ?? null;
  }

  function getFilename(videoId: string) {
    return videoDetails[videoId]?.filenameOutput ?? videoId;
  }

  function getQuality(videoId: string) {
    return videoDetails[videoId]?.quality ?? "";
  }

  function getVideoStatusLabel(i: number) {
    if (i === 0) {
      return isFFmpegReady ? "Processing…" : "Waiting for FFmpeg…";
    }

    return "Downloading";
  }
</script>

<DownloadSection
  cancelAriaLabel="Cancel all video downloads"
  listAriaLabel="Active video downloads"
  loadingBadge={!isFFmpegReady ? "Loading FFmpeg…" : undefined}
  onCancelAll={() => onCancel(videoDownloadIds)}
  sectionId="video-downloads"
  title="Video downloads"
  videoIds={videoDownloadIds}
>
  {#snippet renderItem(videoId, i)}
    <li
      class="download-item"
      class:download-item--active={i === 0}
      aria-label={getFilename(videoId)}
      role="listitem"
    >
      <DownloadItem
        filename={getFilename(videoId)}
        oncancel={() => onCancel([videoId])}
        progress={getProgress(videoId)}
        progressLabel={getProgressLabel(videoId)}
        quality={getQuality(videoId)}
        statusLabel={getProgress(videoId) === null ? getVideoStatusLabel(i) : null}
      />
    </li>
  {/snippet}
</DownloadSection>

<DownloadSection
  cancelAriaLabel="Cancel all audio downloads"
  listAriaLabel="Audio downloads"
  onCancelAll={() => onCancel(musicList)}
  sectionId="music-list"
  title="Audio"
  videoIds={musicList}
>
  {#snippet renderItem(videoId)}
    <li class="download-item" role="listitem">
      <DownloadItem
        filename={getFilename(videoId)}
        oncancel={() => onCancel([videoId])}
        progress={getProgress(videoId)}
        progressLabel={getProgressLabel(videoId)}
      />
    </li>
  {/snippet}
</DownloadSection>

<DownloadSection
  cancelAriaLabel="Cancel all video-only downloads"
  listAriaLabel="Video-only downloads"
  onCancelAll={() => onCancel(videoOnlyList)}
  sectionId="video-only"
  title="Video only"
  videoIds={videoOnlyList}
>
  {#snippet renderItem(videoId)}
    <li class="download-item" role="listitem">
      <DownloadItem
        filename={getFilename(videoId)}
        oncancel={() => onCancel([videoId])}
        progress={getProgress(videoId)}
        progressLabel={getProgressLabel(videoId)}
      />
    </li>
  {/snippet}
</DownloadSection>

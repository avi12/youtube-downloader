<script lang="ts">
  import { bindDownloadAccessors, getVideoStatusLabel } from "./active-downloads-helpers";
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
    isFFmpegReady, videoDownloads, musicList, videoOnlyList,
    videoDetails, statusProgress, percentFormatter, onCancel
  }: Props = $props();

  const videoDownloadIds = $derived(videoDownloads.map(item => item.videoId));
  const accessors = $derived(bindDownloadAccessors(statusProgress, videoDetails, percentFormatter));
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
      aria-label={accessors.filename(videoId)}
      role="listitem"
    >
      <DownloadItem
        filename={accessors.filename(videoId)}
        oncancel={() => onCancel([videoId])}
        progress={accessors.progress(videoId)}
        progressLabel={accessors.label(videoId)}
        quality={accessors.quality(videoId)}
        statusLabel={accessors.progress(videoId) === null ? getVideoStatusLabel(i, isFFmpegReady) : null}
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
        filename={accessors.filename(videoId)}
        oncancel={() => onCancel([videoId])}
        progress={accessors.progress(videoId)}
        progressLabel={accessors.label(videoId)}
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
        filename={accessors.filename(videoId)}
        oncancel={() => onCancel([videoId])}
        progress={accessors.progress(videoId)}
        progressLabel={accessors.label(videoId)}
      />
    </li>
  {/snippet}
</DownloadSection>

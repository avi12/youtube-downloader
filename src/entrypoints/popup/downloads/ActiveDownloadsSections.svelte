<script lang="ts">
  import { bindDownloadAccessors, getVideoStatusLabel } from "./active-downloads-helpers";
  import DownloadItem from "./DownloadItem.svelte";
  import DownloadSection from "./DownloadSection.svelte";
  import { ProgressType } from "@/types";
  import type { VideoQueueItem } from "@/types";
  import { SvelteSet } from "svelte/reactivity";

  interface Props {
    isFFmpegReady: boolean;
    videoDownloads: VideoQueueItem[];
    musicList: string[];
    videoOnlyList: string[];
    videoDetails: Record<string, {
      filenameOutput: string;
      quality?: string;
      tabId?: number;
      isZipBundle?: boolean;
    }>;
    statusProgress: Record<string, {
      progress: number;
      progressType: ProgressType;
    }>;
    percentFormatter: Intl.NumberFormat;
    currentTabId?: number;
    onCancel: (videoIds: string[]) => void;
  }

  const {
    isFFmpegReady, videoDownloads, musicList, videoOnlyList,
    videoDetails, statusProgress, percentFormatter, currentTabId, onCancel
  }: Props = $props();

  const accessors = $derived(
    bindDownloadAccessors({
      statusProgress,
      videoDetails,
      percentFormatter
    })
  );

  const thisTabIds = $derived(
    (() => {
      if (currentTabId === undefined) {
        return new SvelteSet<string>();
      }

      const ids = new SvelteSet<string>();
      for (const item of videoDownloads) {
        if (videoDetails[item.videoId]?.tabId === currentTabId) {
          ids.add(item.videoId);
        }
      }

      for (const id of musicList) {
        if (videoDetails[id]?.tabId === currentTabId) {
          ids.add(id);
        }
      }

      for (const id of videoOnlyList) {
        if (videoDetails[id]?.tabId === currentTabId) {
          ids.add(id);
        }
      }

      return ids;
    })()
  );

  const thisTabVideoIds = $derived(
    (() => {
      if (thisTabIds.size === 0) {
        return [];
      }

      const ids: string[] = [];
      for (const item of videoDownloads) {
        if (thisTabIds.has(item.videoId)) {
          ids.push(item.videoId);
        }
      }

      for (const id of musicList) {
        if (thisTabIds.has(id)) {
          ids.push(id);
        }
      }

      for (const id of videoOnlyList) {
        if (thisTabIds.has(id)) {
          ids.push(id);
        }
      }

      return ids;
    })()
  );

  const otherVideoDownloadIds = $derived(
    thisTabIds.size > 0
      ? videoDownloads.filter(item => !thisTabIds.has(item.videoId)).map(item => item.videoId)
      : videoDownloads.map(item => item.videoId)
  );
  const otherMusicList = $derived(
    thisTabIds.size > 0 ? musicList.filter(id => !thisTabIds.has(id)) : musicList
  );
  const otherVideoOnlyList = $derived(
    thisTabIds.size > 0 ? videoOnlyList.filter(id => !thisTabIds.has(id)) : videoOnlyList
  );
  const videoDownloadIds = $derived(videoDownloads.map(item => item.videoId));
</script>

{#if thisTabVideoIds.length > 0}
  <DownloadSection
    cancelAriaLabel="Cancel all downloads from this tab"
    listAriaLabel="Downloads from this tab"
    onCancelAll={() => onCancel(thisTabVideoIds)}
    sectionId="this-tab"
    title="This tab"
    videoIds={thisTabVideoIds}
  >
    {#snippet renderItem(videoId)}
      <li class="download-item" role="listitem">
        <DownloadItem
          filename={accessors.filename(videoId)}
          oncancel={() => onCancel([videoId])}
          outputBadge={videoDetails[videoId]?.isZipBundle ? "ZIP" : undefined}
          progress={accessors.progress(videoId)}
          progressLabel={accessors.label(videoId)}
          quality={accessors.quality(videoId)}
        />
      </li>
    {/snippet}
  </DownloadSection>
{/if}

<DownloadSection
  cancelAriaLabel="Cancel all video downloads"
  listAriaLabel="Active video downloads"
  loadingBadge={!isFFmpegReady ? "Loading FFmpeg…" : undefined}
  onCancelAll={() => onCancel(videoDownloadIds)}
  sectionId="video-downloads"
  title="Video downloads"
  videoIds={otherVideoDownloadIds}
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
        statusLabel={accessors.progress(videoId) === null ? getVideoStatusLabel({
          i,
          isFFmpegReady
        }) : null}
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
  videoIds={otherMusicList}
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
  videoIds={otherVideoOnlyList}
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

<style>
  .download-item {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 12px;
    border: none;
    border-radius: 16px;
    background: var(--surface);
    transition: background-color 200ms;
  }

  .download-item--active {
    padding-left: 9px;
    border-left: 3px solid var(--accent);
  }
</style>

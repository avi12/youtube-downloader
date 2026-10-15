<script lang="ts">
  import DownloadOptionsForm from "./DownloadOptionsForm.svelte";
  import { createPopupPanelHost } from "./popup-panel-host";
  import { readTabVideoData } from "./tab-video-data";
  import { initContentOptions } from "@/lib/ui/synced-stores.svelte.ts";
  import { createLogger, LogScope } from "@/lib/utils/logger";
  import type { Options } from "@/types";
  import { untrack } from "svelte";

  const log = createLogger(LogScope.Popup);

  interface Props {
    tabId: number;
    videoId: string;
    sourceUrl: string;
    options: Options;
    onRequested: () => void;
  }

  const props: Props = $props();

  // The panel reads the settings the way the page does, so the popup feeds it the same live copy
  $effect.pre(() => {
    initContentOptions($state.snapshot(props.options));
  });

  // The card mounts per opening, so the tab it reads is fixed for its lifetime
  const { tabId, videoId, sourceUrl } = untrack(() => props);
  const videoDataPromise = readTabVideoData({
    tabId,
    videoId
  }).catch(error => {
    log.warn("Reading the tab's video data failed:", error);
    return null;
  });
  const host = createPopupPanelHost({
    sourceUrl,
    onRequested: () => props.onRequested()
  });
</script>

<section id="download-options-card" class="options-card" aria-label="Download options">
  {#await videoDataPromise}
    <p class="options-card-status">Reading this video's formats</p>
  {:then videoData}
    {#if videoData?.isDownloadable}
      <DownloadOptionsForm {host} {videoData} />
    {:else}
      <p class="options-card-status">Can't read this video's formats - reload the page and try again</p>
    {/if}
  {/await}
</section>

<style>
  .options-card {
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--surface-high);
    animation: options-card-in 220ms cubic-bezier(0.2, 0, 0, 1);
  }

  .options-card-status {
    margin: 0;
    color: var(--fg-muted);
    font-size: 0.8125rem;
    text-align: center;
  }

  @keyframes options-card-in {
    from {
      opacity: 0%;
      translate: 0 -6px;
    }
  }
</style>

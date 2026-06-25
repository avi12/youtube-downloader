<script lang="ts">
  import { createAppState, PopupPanel } from "./app-state.svelte";
  import DownloadsTab from "./downloads/DownloadsTab.svelte";
  import ChangeFormatDialog from "./format-dialog/ChangeFormatDialog.svelte";
  import SettingsTab from "./settings/SettingsTab.svelte";
  import TabNav from "./shared/TabNav.svelte";
  import UpdateBanner from "./shared/UpdateBanner.svelte";
  import type { DownloadProgressEntry, Options, VideoDetail, VideoQueueItem } from "@/types";
  import { browser } from "#imports";
  import { onMount, untrack } from "svelte";
  import { cubicOut } from "svelte/easing";
  import { fly } from "svelte/transition";

  interface Props {
    initialIsFFmpegReady: boolean;
    initialVideoQueue: VideoQueueItem[];
    initialMusicList: string[];
    initialVideoOnlyList: string[];
    initialVideoDetails: Record<string, VideoDetail>;
    initialStatusProgress: Record<string, DownloadProgressEntry>;
    initialCurrentTabId?: number;
    initialCurrentSourceUrl?: string;
    initialOptions: Options;
    initialUpdateAvailableVersion: string | null;
  }

  const {
    initialIsFFmpegReady,
    initialVideoQueue,
    initialMusicList,
    initialVideoOnlyList,
    initialVideoDetails,
    initialStatusProgress,
    initialCurrentTabId,
    initialCurrentSourceUrl,
    initialOptions,
    initialUpdateAvailableVersion
  }: Props = $props();

  onMount(() => {
    if (initialUpdateAvailableVersion) {
      browser.action.setBadgeText({ text: "" }).catch(() => {});
    }
  });

  const percentFormatter = new Intl.NumberFormat(browser.i18n.getUILanguage(), {
    style: "percent",
    maximumFractionDigits: 0
  });

  const appState = createAppState(
    untrack(() => ({
      initialIsFFmpegReady,
      initialVideoQueue,
      initialMusicList,
      initialVideoOnlyList,
      initialVideoDetails,
      initialStatusProgress,
      initialCurrentTabId,
      initialCurrentSourceUrl,
      initialOptions
    }))
  );

  const SLIDE_DURATION = 200;
  const PANEL_ORDER = [PopupPanel.Downloads, PopupPanel.Settings] as const;
  let slideDirection = $state(1);
  const flyIn = $derived({
    x: slideDirection * 50,
    duration: SLIDE_DURATION,
    opacity: 0,
    easing: cubicOut
  });
  const flyOut = $derived({
    x: -slideDirection * 50,
    duration: SLIDE_DURATION,
    opacity: 0,
    easing: cubicOut
  });

  function handleTabChange(id: PopupPanel): void {
    const iPrevious = PANEL_ORDER.indexOf(appState.activePanel);
    const iNext = PANEL_ORDER.indexOf(id);
    slideDirection = iNext > iPrevious ? 1 : -1;
    appState.activePanel = id;
  }
</script>

<main class="popup-container">
  <header class="popup-header">
    <div class="popup-header-top">
      <h1 class="popup-title">YouTube Downloader</h1>
      <span class="popup-credit">
        by <a href="https://avi12.com" target="_blank">Avi</a>
      </span>
    </div>
    <TabNav
      activeTab={appState.activePanel}
      initialActiveTab={PopupPanel.Downloads}
      onChange={handleTabChange}
      tabs={appState.tabs}
    />
  </header>

  {#if initialUpdateAvailableVersion}
    <UpdateBanner version={initialUpdateAvailableVersion} />
  {/if}

  <div class="popup-content">
    {#if appState.activePanel === PopupPanel.Downloads}
      <div
        id="panel-downloads"
        class="panel-wrapper"
        role="tabpanel"
        in:fly={flyIn}
        out:fly={flyOut}
      >
        <DownloadsTab
          currentSourceUrl={appState.currentSourceUrl}
          currentTabId={appState.currentTabId}
          isFFmpegReady={appState.isFFmpegReady}
          musicList={appState.musicList}
          now={appState.now}
          onCancel={appState.cancelDownloads}
          onChangeFormat={appState.handleChangeFormat}
          onRecentChanged={appState.refreshRecentDownloads}
          pendingFormatChangeId={appState.pendingFormatChangeEntry?.id ?? null}
          {percentFormatter}
          recentDownloads={appState.recentDownloads}
          statusProgress={appState.statusProgress}
          videoDetails={appState.videoDetails}
          videoDownloads={appState.videoDownloads}
          videoOnlyList={appState.videoOnlyList}
        />
      </div>
    {:else}
      <div
        id="panel-settings"
        class="panel-wrapper"
        role="tabpanel"
        in:fly={flyIn}
        out:fly={flyOut}
      >
        <SettingsTab options={appState.options} />
      </div>
    {/if}
  </div>
</main>

{#if appState.pendingFormatChangeEntry}
  <ChangeFormatDialog
    entry={appState.pendingFormatChangeEntry}
    onClose={appState.handleCloseDialog}
  />
{/if}

<style>
    :global {
      @media (prefers-reduced-motion: reduce) {
        *,
        *::before,
        *::after {
          transition-duration: 0.01ms !important;
          animation-duration: 0.01ms !important;
          animation-iteration-count: 1 !important;
        }

        [data-tooltip]::after {
          transition: none;
        }
      }

      [data-tooltip] {
        position: relative;

        &::after {
          content: attr(data-tooltip);
          position: absolute;
          bottom: calc(100% + 6px);
          inset-inline-start: 0;
          z-index: 10;
          width: max-content;
          max-width: 240px;
          padding: 6px 12px;
          border-radius: 8px;
          background: var(--md-sys-color-inverse-surface, var(--fg));
          color: var(--md-sys-color-inverse-on-surface, var(--bg));
          font-weight: 500;
          font-size: 0.75rem;
          line-height: 1rem;
          letter-spacing: 0.025em;
          white-space: normal;
          overflow-wrap: anywhere;
          opacity: 0%;
          box-shadow:
            0 2px 6px 2px color-mix(in oklab, var(--fg) 15%, transparent),
            0 1px 2px 0 color-mix(in oklab, var(--fg) 30%, transparent);
          pointer-events: none;
          transition: opacity 150ms cubic-bezier(0.2, 0, 0, 1);
        }

        &[data-tooltip-align="end"]::after {
          inset-inline-end: 0;
          inset-inline-start: auto;
        }

        &:hover::after,
        &:focus-visible::after {
          opacity: 100%;
          transition-delay: 500ms;
        }
      }

      html {
        font-size: max(1rem, 16px);
      }

      body {
        --md-sys-color-surface: oklch(98.4% 0.0128 321.9deg);
        --md-sys-color-surface-container: oklch(95.4% 0.0147 312.2deg);
        --md-sys-color-surface-container-high: oklch(93.3% 0.0148 312.2deg);
        --md-sys-color-surface-container-highest: oklch(91.4% 0.0137 314.8deg);
        --md-sys-color-on-surface: oklch(22.7% 0.01 303.7deg);
        --md-sys-color-on-surface-variant: oklch(39.8% 0.0174 303.7deg);
        --md-sys-color-outline: oklch(51.6% 0.0186 309.9deg);
        --md-sys-color-outline-variant: oklch(82.9% 0.0178 308.2deg);
        --md-sys-color-primary: oklch(49.6% 0.1305 293.7deg);
        --md-sys-color-on-primary: oklch(100% 0 0deg);
        --md-sys-color-primary-container: oklch(91.8% 0.0477 302.8deg);
        --md-sys-color-secondary-container: oklch(91.6% 0.0365 303.1deg);
        --md-sys-color-error: oklch(50.1% 0.1783 28.7deg);
        --md-sys-color-error-container: oklch(92.2% 0.0301 22.8deg);
        --md-sys-color-on-error-container: oklch(25.4% 0.0794 27.6deg);
        --md-sys-color-inverse-surface: oklch(30.4% 0.0132 305.1deg);
        --md-sys-color-inverse-on-surface: oklch(94.9% 0.0118 314.1deg);
        --bg: var(--md-sys-color-surface);
        --fg: var(--md-sys-color-on-surface);
        --fg-muted: var(--md-sys-color-on-surface-variant);
        --fg-subtle: var(--md-sys-color-outline);
        --border: var(--md-sys-color-outline-variant);
        --accent: var(--md-sys-color-primary);
        --accent-container: var(--md-sys-color-primary-container);
        --accent-hover: var(--md-sys-color-secondary-container);
        --danger: var(--md-sys-color-error);
        --danger-hover: var(--md-sys-color-error-container);
        --on-danger: oklch(100% 0 0deg);
        --surface: var(--md-sys-color-surface-container);
        --surface-high: var(--md-sys-color-surface-container-high);
        --on-primary: var(--md-sys-color-on-primary);
        --premium: oklch(68% 0.155 80deg);
        --motion: 1;

        width: 400px;
        min-height: 600px;
        margin: 0;
        background-color: var(--bg);
        color: var(--fg);
        font-family: "Roboto Flex", Roboto, system-ui, sans-serif;
        font-size: 0.875rem;
        line-height: 1.5;

        @media (prefers-color-scheme: dark) {
          --md-sys-color-surface: oklch(18.7% 0.0124 300.4deg);
          --md-sys-color-surface-container: oklch(24.5% 0.0134 298.5deg);
          --md-sys-color-surface-container-high: oklch(28.6% 0.0129 298.6deg);
          --md-sys-color-surface-container-highest: oklch(33% 0.0125 298.8deg);
          --md-sys-color-on-surface: oklch(91.4% 0.0137 314.8deg);
          --md-sys-color-on-surface-variant: oklch(82.9% 0.0178 308.2deg);
          --md-sys-color-outline: oklch(65.7% 0.0153 304deg);
          --md-sys-color-outline-variant: oklch(39.8% 0.0174 303.7deg);
          --md-sys-color-primary: oklch(83.5% 0.0946 298deg);
          --md-sys-color-on-primary: oklch(32.5% 0.1353 291.2deg);
          --md-sys-color-primary-container: oklch(41% 0.1337 292.7deg);
          --md-sys-color-secondary-container: oklch(40.1% 0.034 298.6deg);
          --md-sys-color-error: oklch(83.4% 0.0677 22deg);
          --md-sys-color-error-container: oklch(42% 0.1473 28.1deg);
          --md-sys-color-on-error-container: oklch(92.2% 0.0301 22.8deg);
          --md-sys-color-inverse-surface: oklch(91.4% 0.0137 314.8deg);
          --md-sys-color-inverse-on-surface: oklch(28.6% 0.0129 298.6deg);
          --on-danger: oklch(25.4% 0.0794 27.6deg);
          --premium: oklch(86% 0.13 85deg);
        }
      }
    }

    .popup-container {
      display: flex;
      flex-direction: column;
      height: 600px;

      .popup-header {
        padding: 16px;
        padding-bottom: 0;
        background: var(--bg);

        .popup-header-top {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 12px;

          .popup-title {
            color: var(--fg);
            font-weight: 600;
            font-size: 1.125rem;
            letter-spacing: 0;
          }

          .popup-credit {
            color: var(--fg-muted);
            font-size: 0.75rem;

            & a {
              color: var(--accent);
              font-weight: 600;
              text-decoration: underline;
              text-underline-offset: 2px;

              &:hover {
                opacity: 80%;
              }
            }
          }
        }
      }

      .popup-content {
        position: relative;
        flex: 1;
        overflow: hidden;
        min-height: 120px;

        .panel-wrapper {
          position: absolute;
          inset: 0;
          overflow-y: auto;
          padding: 16px;
          scrollbar-color: var(--border) transparent;
          scrollbar-width: thin;

          &::-webkit-scrollbar {
            width: 6px;
          }

          &::-webkit-scrollbar-track {
            background: transparent;
          }

          &::-webkit-scrollbar-thumb {
            border-radius: 3px;
            background: var(--border);
          }

          &::-webkit-scrollbar-thumb:hover {
            background: var(--fg-subtle);
          }
        }
      }
    }
</style>

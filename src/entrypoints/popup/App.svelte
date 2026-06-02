<script lang="ts">
  import { createAppState, PopupPanel } from "./app-state.svelte";
  import DownloadsTab from "./downloads/DownloadsTab.svelte";
  import ChangeFormatDialog from "./format-dialog/ChangeFormatDialog.svelte";
  import closeIcon from "./icons/close.svg?raw";
  import SettingsTab from "./settings/SettingsTab.svelte";
  import TabNav from "./shared/TabNav.svelte";
  import type { DownloadProgressEntry, Options, VideoDetail, VideoQueueItem } from "@/types";
  import { browser } from "#imports";
  import { untrack } from "svelte";
  import { cubicOut } from "svelte/easing";
  import { fly } from "svelte/transition";

  const SUN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;
  const MOON_ICON = `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

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
    initialOptions
  }: Props = $props();

  const percentFormatter = new Intl.NumberFormat(browser.i18n.getUILanguage(), {
    style: "percent",
    maximumFractionDigits: 0
  });

  const logoUrl = new URL("/icons/48.png", location.href).href;

  type Theme = "system" | "light" | "dark";
  const THEME_KEY = "ytdl-theme";

  function readTheme(): Theme {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") {
      return stored;
    }

    return "system";
  }

  let theme = $state<Theme>(readTheme());

  const isDark = $derived(
    theme === "dark"
    || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  );

  $effect(() => {
    const root = document.documentElement;
    if (theme === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", theme);
    }

    if (theme === "system") {
      localStorage.removeItem(THEME_KEY);
    } else {
      localStorage.setItem(THEME_KEY, theme);
    }
  });

  function toggleTheme(): void {
    theme = isDark ? "light" : "dark";
  }

  function detectPageContext(url?: string): string | null {
    if (!url) {
      return null;
    }

    if (url.includes("youtube.com/watch")) {
      return "Watch page";
    }

    if (url.includes("youtube.com/playlist")) {
      return "Playlist page";
    }

    if (/youtube\.com\/(@|c\/|channel\/)/.test(url)) {
      return "Channel page";
    }

    if (/youtube\.com\/?($|\?)/.test(url) || url.includes("youtube.com/feed")) {
      return "YouTube home";
    }

    return null;
  }

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

  const pageContext = $derived(detectPageContext(appState.currentSourceUrl));

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
      <div class="popup-header-identity">
        <img class="popup-logo" alt="" aria-hidden="true" height="40" src={logoUrl} width="40" />
        <div class="popup-header-text">
          <h1 class="popup-title">YouTube Downloader</h1>
          {#if pageContext}
            <span class="popup-context">{pageContext}</span>
          {/if}
        </div>
      </div>
      <div class="popup-header-actions">
        <button
          class="popup-header-btn"
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          data-tooltip={isDark ? "Switch to light mode" : "Switch to dark mode"}
          data-tooltip-align="end"
          onclick={toggleTheme}
          type="button"
        >
          {@html isDark ? SUN_ICON : MOON_ICON}
        </button>
        <button
          class="popup-header-btn"
          aria-label="Close"
          data-tooltip="Close"
          data-tooltip-align="end"
          onclick={() => window.close()}
          type="button"
        >
          {@html closeIcon}
        </button>
      </div>
    </div>
    <TabNav
      activeTab={appState.activePanel}
      initialActiveTab={PopupPanel.Downloads}
      onChange={handleTabChange}
      tabs={appState.tabs}
    />
  </header>

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
        [data-tooltip]::after {
          transition: none;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        *,
        *::before,
        *::after {
          transition-duration: 0.01ms !important;
          animation-duration: 0.01ms !important;
          animation-iteration-count: 1 !important;
        }
      }

      [data-tooltip] {
        position: relative;
      }

      [data-tooltip]::after {
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

      [data-tooltip][data-tooltip-align="end"]::after {
        inset-inline-end: 0;
        inset-inline-start: auto;
      }

      [data-tooltip]:hover::after,
      [data-tooltip]:focus-visible::after {
        opacity: 100%;
        transition-delay: 500ms;
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
        }
      }
    }

    html[data-theme="dark"] body {
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
    }

    html[data-theme="light"] body {
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
      --on-danger: oklch(100% 0 0deg);
    }

    .popup-container {
      display: flex;
      flex-direction: column;
      height: 600px;

      .popup-header {
        padding: 12px 16px 0;
        background: var(--bg);

        .popup-header-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;

          .popup-header-identity {
            display: flex;
            gap: 10px;
            align-items: center;
            min-width: 0;

            .popup-logo {
              flex-shrink: 0;
              width: 40px;
              height: 40px;
              border-radius: 12px;
            }

            .popup-header-text {
              display: flex;
              flex-direction: column;
              gap: 1px;
              min-width: 0;

              .popup-title {
                color: var(--fg);
                font-weight: 600;
                font-size: 1rem;
                letter-spacing: 0;
                white-space: nowrap;
              }

              .popup-context {
                overflow: hidden;
                color: var(--fg-muted);
                font-size: 0.6875rem;
                text-overflow: ellipsis;
                white-space: nowrap;
              }
            }
          }

          .popup-header-actions {
            display: flex;
            flex-shrink: 0;
            gap: 2px;
            align-items: center;

            .popup-header-btn {
              display: flex;
              justify-content: center;
              align-items: center;
              width: 32px;
              height: 32px;
              padding: 0;
              border: none;
              border-radius: 50%;
              background: transparent;
              color: var(--fg-muted);
              cursor: pointer;
              transition: background-color 200ms, color 200ms;

              &:hover {
                background: var(--accent-hover);
                color: var(--fg);
              }

              &:focus-visible {
                outline: 2px solid var(--accent);
                outline-offset: 2px;
              }

              :global(svg) {
                width: 18px;
                height: 18px;
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

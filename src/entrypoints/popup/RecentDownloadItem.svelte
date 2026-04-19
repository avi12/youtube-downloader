<script lang="ts">
  import moreActionsIcon from "./icons/more-actions.svg?raw";
  import type { RecentDownloadEntry } from "@/types";

  type Props = {
    entry: RecentDownloadEntry;
    now: number;
    onShowInFolder: () => void;
    onChangeFormat: () => void;
    onRemove: () => void;
  };

  const { entry, now, onShowInFolder, onChangeFormat, onRemove }: Props = $props();

  let isMenuOpen = $state(false);
  let elMenu = $state<HTMLDivElement | null>(null);
  let elTrigger = $state<HTMLButtonElement | null>(null);

  const relativeAgeLabel = $derived(formatRelativeAge(now - entry.completedAt));
  const sizeLabel = $derived(formatBytes(entry.size));

  const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;
  const BYTE_DECIMALS = [0, 0, 1, 2] as const;
  const AGE_THRESHOLDS: [number, Intl.RelativeTimeFormatUnit, number][] = [
    [60, "second", 1],
    [3600, "minute", 60],
    [Infinity, "hour", 3600]
  ];

  function formatRelativeAge(deltaMs: number) {
    const totalSeconds = Math.floor(deltaMs / 1000);
    const [, unit, divisor] = AGE_THRESHOLDS.find(([threshold]) => totalSeconds < threshold)!;
    return RTF.format(-Math.floor(totalSeconds / divisor), unit);
  }

  function formatBytes(bytes: number) {
    if (bytes === 0) {
      return "0 B";
    }

    const unitIndex = Math.min(Math.floor(Math.log2(bytes) / 10), BYTE_UNITS.length - 1);
    const scaled = (bytes / 1024 ** unitIndex).toFixed(BYTE_DECIMALS[unitIndex]);
    return `${scaled} ${BYTE_UNITS[unitIndex]}`;
  }

  function closeMenu() {
    isMenuOpen = false;
    elTrigger?.focus();
  }

  function handleMenuAction(action: () => void) {
    action();
    closeMenu();
  }

  function handleDocumentClick(e: MouseEvent) {
    if (!isMenuOpen) {
      return;
    }

    const { target } = e;
    if (target instanceof Node && (elMenu?.contains(target) || elTrigger?.contains(target))) {
      return;
    }

    closeMenu();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (isMenuOpen && e.key === "Escape") {
      e.preventDefault();
      closeMenu();
    }
  }

  $effect(() => {
    if (!isMenuOpen) {
      return;
    }

    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
      document.removeEventListener("keydown", handleKeydown);
    };
  });
</script>

<article class="recent-item">
  {#if entry.thumbnailUrl}
    <img
      class="recent-thumb"
      alt=""
      height="48"
      src={entry.thumbnailUrl}
      width="48"
    />
  {:else}
    <div class="recent-thumb recent-thumb-placeholder" aria-hidden="true">
      {#if entry.container}
        <span class="recent-thumb-container">{entry.container.toUpperCase()}</span>
      {/if}
    </div>
  {/if}

  <div class="recent-body">
    <button
      class="recent-filename"
      data-tooltip={entry.filename}
      dir="auto"
      onclick={onShowInFolder}
      onkeydown={e => {
        if (e.key !== "Enter" && e.key !== " ") {
          return;
        }

        e.preventDefault();
        onShowInFolder();
      }}
      type="button"
    >
      <span class="recent-filename-text">{entry.title}</span>
    </button>
    <p class="recent-meta" dir="auto">
      {#if entry.channel}<span>{entry.channel}</span> · {/if}
      <span>{sizeLabel}</span> ·
      <span>{relativeAgeLabel}</span>
    </p>
  </div>

  <div class="recent-menu-wrap">
    <button
      bind:this={elTrigger}
      class="recent-menu-trigger"
      aria-expanded={isMenuOpen}
      aria-haspopup="menu"
      aria-label="More actions"
      onclick={() => {
        isMenuOpen = !isMenuOpen;
      }}
      type="button"
    >
      {@html moreActionsIcon}
    </button>

    {#if isMenuOpen}
      <div
        bind:this={elMenu}
        class="recent-menu"
        role="menu"
      >
        <button
          class="recent-menu-item"
          dir="auto"
          onclick={() => handleMenuAction(onShowInFolder)}
          role="menuitem"
          type="button"
        >
          Show in folder
        </button>
        {#if entry.container !== "zip"}
          <button
            class="recent-menu-item"
            dir="auto"
            onclick={() => handleMenuAction(onChangeFormat)}
            role="menuitem"
            type="button"
          >
            Change format…
          </button>
        {/if}
        <button
          class="recent-menu-item recent-menu-item-danger"
          dir="auto"
          onclick={() => handleMenuAction(onRemove)}
          role="menuitem"
          type="button"
        >
          Remove
        </button>
      </div>
    {/if}
  </div>
</article>

<style>
  .recent-item {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--surface);
    transition: background-color 200ms;

    &:hover {
      background: var(--surface-high);
    }
  }

  .recent-thumb {
    flex-shrink: 0;
    object-fit: cover;
    width: 48px;
    height: 48px;
    border-radius: 8px;
    background: var(--surface-high);
  }

  .recent-thumb-placeholder {
    display: flex;
    justify-content: center;
    align-items: center;
    background: linear-gradient(135deg, var(--surface-high), var(--border));
  }

  .recent-thumb-container {
    color: var(--fg-muted);
    font-weight: 700;
    font-size: 0.625rem;
    letter-spacing: 0.04em;
  }

  .recent-body {
    flex: 1;
    min-width: 0;
  }

  .recent-filename {
    position: relative;
    display: block;
    width: 100%;
    padding: 0;
    border: none;
    background: none;
    color: var(--fg);
    font-family: inherit;
    font-weight: 500;
    font-size: 0.8125rem;
    text-align: left;
    cursor: pointer;

    &:focus-visible {
      border-radius: 4px;
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    &::after {
      content: attr(data-tooltip);
      position: absolute;
      bottom: calc(100% + 4px);
      left: 0;
      z-index: 10;
      max-width: 280px;
      padding: 4px 8px;
      border-radius: 6px;
      background: var(--fg);
      color: var(--bg);
      font-weight: 400;
      font-size: 0.6875rem;
      word-break: break-all;
      opacity: 0%;
      pointer-events: none;
      transition: opacity 150ms;
    }

    &:hover::after,
    &:focus-visible::after {
      opacity: 100%;
    }
  }

  .recent-filename-text {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    .recent-filename:hover &,
    .recent-filename:focus-visible & {
      text-decoration: underline;
    }
  }

  .recent-meta {
    overflow: hidden;
    margin-top: 2px;
    color: var(--fg-muted);
    font-size: 0.6875rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .recent-menu-wrap {
    flex-shrink: 0;
  }

  .recent-menu-trigger {
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
    transition: background-color 150ms;
    anchor-name: --recent-menu-trigger;

    &:hover {
      background: var(--surface-high);
    }

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
  }

  .recent-menu {
    position: fixed;
    top: anchor(bottom);
    right: anchor(right);
    z-index: 10;
    display: flex;
    flex-direction: column;
    min-width: 160px;
    padding: 4px;
    border-radius: 12px;
    background: var(--surface-high);
    box-shadow: 0 4px 16px rgb(0 0 0 / 15%);
    animation: menu-in 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
    position-anchor: --recent-menu-trigger;
  }

  @keyframes menu-in {
    from {
      opacity: 0%;
      transform: scale(0.92) translateY(-4px);
    }

    to {
      opacity: 100%;
      transform: scale(1) translateY(0);
    }
  }

  .recent-menu-item {
    padding: 8px 12px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--fg);
    font-family: inherit;
    font-size: 0.8125rem;
    cursor: pointer;

    &:hover,
    &:focus-visible {
      background: var(--accent-container);
      color: var(--fg);
    }

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }
  }

  .recent-menu-item-danger {
    color: var(--danger);

    &:hover,
    &:focus-visible {
      background: var(--danger-hover);
      color: var(--danger);
    }
  }
</style>

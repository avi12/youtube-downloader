<script lang="ts">
  import RecentDownloadMenu from "./RecentDownloadMenu.svelte";
  import type { RecentDownloadEntry } from "@/types";

  interface Props {
    entry: RecentDownloadEntry;
    now: number;
    onShowInFolder: () => void;
    onChangeFormat: () => void;
    onRemove: () => void;
  }

  const { entry, now, onShowInFolder, onChangeFormat, onRemove }: Props = $props();

  let isMenuOpen = $state(false);

  const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;
  const BYTE_DECIMALS = [0, 0, 1, 2] as const;
  const AGE_THRESHOLDS: [number, Intl.RelativeTimeFormatUnit, number][] = [
    [60, "second", 1],
    [3600, "minute", 60],
    [Infinity, "hour", 3600]
  ];

  const relativeAgeLabel = $derived(formatRelativeAge(now - entry.completedAt));
  const sizeLabel = $derived(formatBytes(entry.size));

  function formatRelativeAge(deltaMs: number) {
    const totalSeconds = Math.floor(deltaMs / 1000);
    const [, unit, divisor] = AGE_THRESHOLDS.find(([threshold]) => totalSeconds < threshold)!;
    return RTF.format(-Math.floor(totalSeconds / divisor), unit);
  }

  function formatBytes(bytes: number) {
    if (bytes === 0) {
      return "0 B";
    }

    const iUnit = Math.min(Math.floor(Math.log2(bytes) / 10), BYTE_UNITS.length - 1);
    const scaled = (bytes / 1024 ** iUnit).toFixed(BYTE_DECIMALS[iUnit]);
    return `${scaled} ${BYTE_UNITS[iUnit]}`;
  }
</script>

<article class="recent-item" class:menu-open={isMenuOpen}>
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
    {#if entry.channel}
      <p class="recent-meta recent-channel" dir="auto">{entry.channel}</p>
    {/if}
    <p class="recent-meta">{sizeLabel} · {relativeAgeLabel}</p>
  </div>

  <RecentDownloadMenu
    entryId={entry.id}
    isZip={entry.container === "zip"}
    {onChangeFormat}
    onMenuOpenChange={value => (isMenuOpen = value)}
    {onRemove}
    {onShowInFolder}
  />
</article>

<script lang="ts">
  import ThumbnailBadge from "./ThumbnailBadge.svelte";

  interface Props {
    lengthSeconds?: number;
  }

  const { lengthSeconds }: Props = $props();

  const SECONDS_PER_MINUTE = 60;
  const SECONDS_PER_HOUR = 3600;

  const durationLabel = $derived.by(() => {
    if (!lengthSeconds || lengthSeconds <= 0) {
      return null;
    }

    const hours = Math.floor(lengthSeconds / SECONDS_PER_HOUR);
    const minutes = Math.floor((lengthSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
    const seconds = Math.floor(lengthSeconds % SECONDS_PER_MINUTE);
    const minutesText = String(minutes).padStart(hours > 0 ? 2 : 1, "0");
    const secondsText = String(seconds).padStart(2, "0");
    return hours > 0 ? `${hours}:${minutesText}:${secondsText}` : `${minutesText}:${secondsText}`;
  });
</script>

{#if durationLabel}
  <ThumbnailBadge label={durationLabel} side="start" />
{/if}

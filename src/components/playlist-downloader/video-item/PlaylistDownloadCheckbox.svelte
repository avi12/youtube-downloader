<script lang="ts">
  import { checkedPlaylistVideos } from "@/lib/ui/playlist-selection.svelte";

  interface Props {
    videoId: string;
    isChecked: boolean;
    isIndeterminate: boolean;
    isDisabled: boolean;
  }

  const { videoId, isChecked, isIndeterminate, isDisabled }: Props = $props();

  let elCheckbox = $state<HTMLElement | null>(null);

  function attachCheckbox(elTarget: Element) {
    if (elTarget instanceof HTMLElement) {
      elCheckbox = elTarget;
    }
  }

  $effect(() => {
    if (!elCheckbox) {
      return;
    }

    if (isIndeterminate) {
      elCheckbox.setAttribute("indeterminate", "");
      elCheckbox.setAttribute("aria-checked", "mixed");
      return;
    }

    elCheckbox.removeAttribute("indeterminate");
    elCheckbox.setAttribute("aria-checked", isChecked ? "true" : "false");
  });
</script>

<tp-yt-paper-checkbox
  {@attach attachCheckbox}
  aria-label="Select for download"
  checked={(isIndeterminate || isChecked) ? "" : undefined}
  disabled={isDisabled ? "" : undefined}
  onchange={e => {
    if (!(e.target instanceof HTMLElement) || isDisabled) {
      return;
    }

    const isNowChecked = e.target.hasAttribute("checked");
    if (isNowChecked && !checkedPlaylistVideos.has(videoId)) {
      checkedPlaylistVideos.add(videoId);
    } else if (!isNowChecked && checkedPlaylistVideos.has(videoId)) {
      checkedPlaylistVideos.delete(videoId);
    }
  }}
></tp-yt-paper-checkbox>

<style>
  /*
   * YouTube strips the indeterminate state from tp-yt-paper-checkbox.
   * These rules restore it using the [indeterminate] attribute and the
   * component's own CSS variables, so the dash adapts to YouTube's theme.
   * Specificity (2,3,1) beats the checkmark animation rule (2,3,0).
   */
  :global(tp-yt-paper-checkbox[indeterminate] #checkbox.tp-yt-paper-checkbox) {
    border-color: var(--paper-checkbox-checked-color, var(--primary-color));
    background-color: var(--paper-checkbox-checked-color, var(--primary-color));

    :global(#checkmark.tp-yt-paper-checkbox) {
      top: 50%;
      left: 25%;
      width: 50%;
      height: 0;
      border-right-width: 0;
      translate: 0 -50%;
      animation-name: none;
    }
  }
</style>

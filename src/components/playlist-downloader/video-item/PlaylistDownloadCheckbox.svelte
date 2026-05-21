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

  function attachCheckbox(elTarget: Element): void {
    const isHtmlElement = elTarget instanceof HTMLElement;
    if (isHtmlElement) {
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
    const isHtmlElement = e.target instanceof HTMLElement;
    const isChangeBlocked = !isHtmlElement || isDisabled;
    if (isChangeBlocked) {
      return;
    }

    const isNowChecked = e.target.hasAttribute("checked");
    const isAddingNew = isNowChecked && !checkedPlaylistVideos.has(videoId);
    if (isAddingNew) {
      checkedPlaylistVideos.add(videoId);
    } else if (!isNowChecked && checkedPlaylistVideos.has(videoId)) {
      checkedPlaylistVideos.delete(videoId);
    }
  }}
></tp-yt-paper-checkbox>

<style>
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

import WatchToast from "@/components/watch-toast/WatchToast.svelte";
import type { VideoData } from "@/types";
import { mount, unmount } from "svelte";

let currentInstance: ReturnType<typeof mount> | null = null;
let currentContainer: HTMLElement | null = null;

function cleanupToastUi() {
  if (currentInstance) {
    void unmount(currentInstance);
    currentInstance = null;
  }

  currentContainer?.remove();
  currentContainer = null;
}

export function mountToastUi({ videoData }: { videoData: VideoData }) {
  cleanupToastUi();

  const elContainer = document.createElement("div");
  const elPopupContainer = document.querySelector("ytd-popup-container") ?? document.body;
  elPopupContainer.append(elContainer);
  currentContainer = elContainer;

  currentInstance = mount(WatchToast, {
    target: elContainer,
    props: { videoData }
  });
}

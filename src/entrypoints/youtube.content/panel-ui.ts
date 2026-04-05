/**
 * Mounts DownloadOptionsPanel into the tp-yt-iron-dropdown slot
 * created by the MAIN world. Stays mounted until navigation so
 * state is preserved across panel open/close cycles.
 */

import DownloadOptionsPanel from "@/components/DownloadOptionsPanel.svelte";
import type { Options, VideoData } from "@/types";
import { mount, unmount } from "svelte";

let currentInstance: ReturnType<typeof mount> | null = null;

export function cleanupPanelUi() {
  if (!currentInstance) {
    return;
  }

  void unmount(currentInstance);
  currentInstance = null;
}

export function mountPanelUi({
  context, contentId, videoData, options
}: {
  context: InstanceType<typeof ContentScriptContext>;
  contentId: string;
  videoData: VideoData;
  options: Options;
}) {
  cleanupPanelUi();

  const elContent = document.getElementById(contentId);
  if (!elContent) {
    return;
  }

  const ui = createIntegratedUi(context, {
    position: "inline",
    anchor: elContent,
    onMount(elUiContainer) {
      currentInstance = mount(DownloadOptionsPanel, {
        target: elUiContainer,
        props: {
          videoData,
          options
        }
      });
    }
  });

  ui.mount();
}

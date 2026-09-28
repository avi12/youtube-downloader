import type { VideoData } from "@/types";
import DownloadOptionsPanel from "#youtube/components/download-options-panel/DownloadOptionsPanel.svelte";
import { mount, unmount } from "svelte";

let currentInstance: ReturnType<typeof mount> | null = null;

export function cleanupPanelUi() {
  if (!currentInstance) {
    return;
  }

  unmount(currentInstance).catch(() => {});
  currentInstance = null;
}

export function mountPanelUi({
  context, contentId, videoData
}: {
  context: InstanceType<typeof ContentScriptContext>;
  contentId: string;
  videoData: VideoData;
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
          videoData
        }
      });
    }
  });

  ui.mount();
}

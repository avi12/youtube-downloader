import WatchToast from "@/components/watch-toast/WatchToast.svelte";
import { mount, unmount } from "svelte";

let toastInstance: ReturnType<typeof mount> | null = null;

export function mountWatchToast(context: InstanceType<typeof ContentScriptContext>) {
  if (toastInstance) {
    return;
  }

  const elTarget = document.createElement("div");
  elTarget.dataset.ytdlWatchToast = "true";
  document.body.append(elTarget);

  toastInstance = mount(WatchToast, { target: elTarget });
  context.onInvalidated(() => {
    if (!toastInstance) {
      return;
    }

    void unmount(toastInstance);
    toastInstance = null;
    elTarget.remove();
  });
}

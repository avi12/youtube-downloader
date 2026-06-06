import WatchSnackbar from "@/components/watch-snackbar/WatchSnackbar.svelte";
import { mount, unmount } from "svelte";

let snackbarInstance: ReturnType<typeof mount> | null = null;

export function mountWatchSnackbar(context: InstanceType<typeof ContentScriptContext>) {
  if (snackbarInstance) {
    return;
  }

  const elTarget = document.createElement("div");
  elTarget.dataset.ytdlWatchSnackbar = "true";
  document.body.append(elTarget);

  snackbarInstance = mount(WatchSnackbar, { target: elTarget });
  context.onInvalidated(() => {
    if (!snackbarInstance) {
      return;
    }

    unmount(snackbarInstance).catch(() => {});
    snackbarInstance = null;
    elTarget.remove();
  });
}

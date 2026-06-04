import { statusProgressItem } from "@/lib/storage/storage";
import { statusProgressSignal } from "@/lib/ui/synced-stores.svelte";

export function syncStoredProgressToStore(
  storedProgress: Awaited<ReturnType<typeof statusProgressItem.getValue>>
) {
  statusProgressSignal.value = storedProgress;
}

export async function restoreStoredProgress() {
  const storedProgress = await statusProgressItem.getValue();
  syncStoredProgressToStore(storedProgress);
}

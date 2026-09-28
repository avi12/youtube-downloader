import { cancelStreamTransfer } from "./stream-transfer";
import { performCancelDownload } from "@/lib/ui/cancel-download";

export async function cancelDownloadsLocally(videoIds: string[]) {
  for (const id of videoIds) {
    cancelStreamTransfer(id);
  }

  await performCancelDownload(videoIds);
}

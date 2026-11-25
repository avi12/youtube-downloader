import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { checkedPlaylistVideosItem, mutateStorageItem } from "@/lib/storage/storage";

export async function performCancelDownload(videoIds: string[]) {
  // A canceled video leaves the playlist selection, whichever button canceled it
  await Promise.all([
    sendMessage(MessageType.CancelDownload, { videoIds }),
    mutateStorageItem({
      item: checkedPlaylistVideosItem,
      mutator(current) {
        const remaining = current.filter(videoId => !videoIds.includes(videoId));
        current.length = 0;
        current.push(...remaining);
      }
    })
  ]);
}

import { musicListItem, videoDetailsItem, videoOnlyListItem, videoQueueItem } from "@/lib/storage/storage";
import { DownloadType } from "@/types";

export async function enqueueToPopupList(videoId: string, type: DownloadType, filenameOutput: string) {
  const details = await videoDetailsItem.getValue();
  details[videoId] = { filenameOutput };
  await videoDetailsItem.setValue(details);

  if (type === DownloadType.VideoAndAudio) {
    const queue = await videoQueueItem.getValue();
    if (!queue.some(item => item.videoId === videoId)) {
      queue.push({ videoId, filenameOutput });
      await videoQueueItem.setValue(queue);
    }

    return;
  }

  const listItem = type === DownloadType.Audio ? musicListItem : videoOnlyListItem;
  const list = await listItem.getValue();
  if (!list.includes(videoId)) {
    list.push(videoId);
    await listItem.setValue(list);
  }
}

export async function removeFromPopupList(videoId: string) {
  const [queue, musicList, videoOnlyList, details] = await Promise.all([
    videoQueueItem.getValue(),
    musicListItem.getValue(),
    videoOnlyListItem.getValue(),
    videoDetailsItem.getValue()
  ]);

  const iQueue = queue.findIndex(item => item.videoId === videoId);
  const iMusic = musicList.indexOf(videoId);
  const iVideoOnly = videoOnlyList.indexOf(videoId);
  const isDetailPresent = videoId in details;

  const writes: Promise<void>[] = [];
  if (iQueue !== -1) {
    queue.splice(iQueue, 1);
    writes.push(videoQueueItem.setValue(queue));
  }

  if (iMusic !== -1) {
    musicList.splice(iMusic, 1);
    writes.push(musicListItem.setValue(musicList));
  }

  if (iVideoOnly !== -1) {
    videoOnlyList.splice(iVideoOnly, 1);
    writes.push(videoOnlyListItem.setValue(videoOnlyList));
  }

  if (isDetailPresent) {
    delete details[videoId];
    writes.push(videoDetailsItem.setValue(details));
  }

  await Promise.all(writes);
}

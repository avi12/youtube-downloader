import { musicListItem, videoDetailsItem, videoOnlyListItem, videoQueueItem } from "@/lib/storage/storage";
import { DownloadType } from "@/types";

export async function enqueueToPopupList(items: Array<{
  videoId: string;
  type: DownloadType;
  filenameOutput: string;
}>) {
  const [details, queue, musicList, videoOnlyList] = await Promise.all([
    videoDetailsItem.getValue(),
    videoQueueItem.getValue(),
    musicListItem.getValue(),
    videoOnlyListItem.getValue()
  ]);

  for (const { videoId, type, filenameOutput } of items) {
    details[videoId] = { filenameOutput };

    if (type === DownloadType.VideoAndAudio) {
      if (!queue.some(item => item.videoId === videoId)) {
        queue.push({
          videoId,
          filenameOutput
        });
      }
    } else if (type === DownloadType.Audio) {
      if (!musicList.includes(videoId)) {
        musicList.push(videoId);
      }
    } else {
      if (!videoOnlyList.includes(videoId)) {
        videoOnlyList.push(videoId);
      }
    }
  }

  await Promise.all([
    videoDetailsItem.setValue(details),
    videoQueueItem.setValue(queue),
    musicListItem.setValue(musicList),
    videoOnlyListItem.setValue(videoOnlyList)
  ]);
}

export async function removeFromPopupList(videoIds: string | string[]) {
  const toRemove = new Set(typeof videoIds === "string" ? [videoIds] : videoIds);

  const [queue, musicList, videoOnlyList, details] = await Promise.all([
    videoQueueItem.getValue(),
    musicListItem.getValue(),
    videoOnlyListItem.getValue(),
    videoDetailsItem.getValue()
  ]);

  const filteredQueue = queue.filter(item => !toRemove.has(item.videoId));
  const filteredMusic = musicList.filter(id => !toRemove.has(id));
  const filteredVideoOnly = videoOnlyList.filter(id => !toRemove.has(id));

  const writes: Promise<void>[] = [];
  if (filteredQueue.length !== queue.length) {
    writes.push(videoQueueItem.setValue(filteredQueue));
  }

  if (filteredMusic.length !== musicList.length) {
    writes.push(musicListItem.setValue(filteredMusic));
  }

  if (filteredVideoOnly.length !== videoOnlyList.length) {
    writes.push(videoOnlyListItem.setValue(filteredVideoOnly));
  }

  const removedDetails = [...toRemove].filter(id => id in details);
  if (removedDetails.length > 0) {
    for (const id of removedDetails) {
      delete details[id];
    }

    writes.push(videoDetailsItem.setValue(details));
  }

  await Promise.all(writes);
}

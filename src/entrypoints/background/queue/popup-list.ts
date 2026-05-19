import { musicListItem, videoDetailsItem, videoOnlyListItem, videoQueueItem } from "@/lib/storage/storage";
import { DownloadType } from "@/types";

export async function enqueueToPopupList({ videoId, type, filenameOutput, quality, tabId, playlistId, playlistTitle }: {
  videoId: string;
  type: DownloadType;
  filenameOutput: string;
  quality?: string;
  tabId?: number;
  playlistId?: string;
  playlistTitle?: string;
}) {
  const details = await videoDetailsItem.getValue();
  details[videoId] = {
    ...details[videoId],
    filenameOutput,
    quality,
    ...(tabId !== undefined && {
      tabId
    }),
    ...(playlistId !== undefined && {
      playlistId
    }),
    ...(playlistTitle !== undefined && {
      playlistTitle
    })
  };
  await videoDetailsItem.setValue(details);

  if (type === DownloadType.VideoAndAudio) {
    const queue = await videoQueueItem.getValue();
    const isVideoQueued = queue.some(item => item.videoId === videoId);
    if (!isVideoQueued) {
      queue.push({
        videoId,
        filenameOutput
      });
      await videoQueueItem.setValue(queue);
    }

    return;
  }

  const listItem = type === DownloadType.Audio ? musicListItem : videoOnlyListItem;
  const list = await listItem.getValue();
  const isVideoListed = list.includes(videoId);
  if (!isVideoListed) {
    list.push(videoId);
    await listItem.setValue(list);
  }
}

export async function removeFromPopupList(videoIds: string | string[]) {
  const videoIdsToRemove = new Set(typeof videoIds === "string" ? [videoIds] : videoIds);

  const [queue, musicList, videoOnlyList, details] = await Promise.all([
    videoQueueItem.getValue(),
    musicListItem.getValue(),
    videoOnlyListItem.getValue(),
    videoDetailsItem.getValue()
  ]);

  const filteredQueue = queue.filter(item => !videoIdsToRemove.has(item.videoId));
  const filteredMusic = musicList.filter(id => !videoIdsToRemove.has(id));
  const filteredVideoOnly = videoOnlyList.filter(id => !videoIdsToRemove.has(id));

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

  let hasRemovedDetails = false;
  for (const id of videoIdsToRemove) {
    if (id in details) {
      delete details[id];
      hasRemovedDetails = true;
    }
  }

  if (hasRemovedDetails) {
    writes.push(videoDetailsItem.setValue(details));
  }

  await Promise.all(writes);
}

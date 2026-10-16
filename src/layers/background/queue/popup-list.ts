import {
  musicListItem,
  statusProgressItem,
  videoDetailsItem,
  videoOnlyListItem,
  videoQueueItem
} from "@/lib/storage/storage";
import { DownloadType } from "@/types";
import type { Prettify } from "@/types";

type EnqueueToPopupListParams = Prettify<{
  videoId: string;
  type: DownloadType;
  filenameOutput: string;
  quality?: string;
  tabId?: number;
  playlistId?: string;
  playlistTitle?: string;
  sourceUrl?: string;
  title?: string;
  channel?: string;
  lengthSeconds?: number;
  thumbnailUrl?: string;
}>;
export async function enqueueToPopupList(
  {
    videoId, type, filenameOutput, quality, tabId, playlistId, playlistTitle, sourceUrl,
    title, channel, lengthSeconds, thumbnailUrl
  }: EnqueueToPopupListParams
) {
  const details = await videoDetailsItem.getValue();
  details[videoId] = {
    ...details[videoId],
    filenameOutput,
    ...(quality !== undefined && {
      quality
    }),
    ...(tabId !== undefined && {
      tabId
    }),
    ...(playlistId !== undefined && {
      playlistId
    }),
    ...(playlistTitle !== undefined && {
      playlistTitle
    }),
    ...(sourceUrl !== undefined && {
      sourceUrl
    }),
    ...(title !== undefined && {
      title
    }),
    ...(channel !== undefined && {
      channel
    }),
    ...(lengthSeconds !== undefined && {
      lengthSeconds
    }),
    ...(thumbnailUrl !== undefined && {
      thumbnailUrl
    })
  };
  await videoDetailsItem.setValue(details);

  const currentStatusProgress = await statusProgressItem.getValue();
  const existingEntry = currentStatusProgress[videoId];
  const isStaleEntry = !existingEntry || existingEntry.isDone || existingEntry.isFailed || !existingEntry.isDownloading;
  if (isStaleEntry) {
    currentStatusProgress[videoId] = {
      isDownloading: true,
      isDone: false,
      progress: 0,
      progressType: ""
    };
    await statusProgressItem.setValue(currentStatusProgress);
  }

  await placeInTypeList({
    videoId,
    type,
    filenameOutput
  });
}

type PlaceInTypeListParams = Prettify<{
  videoId: string;
  type: DownloadType;
  filenameOutput: string;
}>;
// A video sits in one list only, so a type resolved later (e.g. inside the download iframe) moves it
async function placeInTypeList({ videoId, type, filenameOutput }: PlaceInTypeListParams) {
  const [queue, musicList, videoOnlyList] = await Promise.all([
    videoQueueItem.getValue(),
    musicListItem.getValue(),
    videoOnlyListItem.getValue()
  ]);
  const isQueueTarget = type === DownloadType.VideoAndAudio;
  const isMusicTarget = type === DownloadType.Audio;

  const writes: Promise<void>[] = [];
  const isQueued = queue.some(item => item.videoId === videoId);
  if (isQueued !== isQueueTarget) {
    writes.push(
      videoQueueItem.setValue(
        isQueueTarget
          ? [...queue, {
            videoId,
            filenameOutput
          }]
          : queue.filter(item => item.videoId !== videoId)
      )
    );
  }

  const nextMusicList = toggleListed({
    list: musicList,
    videoId,
    isListed: isMusicTarget
  });
  if (nextMusicList) {
    writes.push(musicListItem.setValue(nextMusicList));
  }

  const nextVideoOnlyList = toggleListed({
    list: videoOnlyList,
    videoId,
    isListed: !isQueueTarget && !isMusicTarget
  });
  if (nextVideoOnlyList) {
    writes.push(videoOnlyListItem.setValue(nextVideoOnlyList));
  }

  await Promise.all(writes);
}

type ToggleListedParams = Prettify<{
  list: string[];
  videoId: string;
  isListed: boolean;
}>;
function toggleListed({ list, videoId, isListed }: ToggleListedParams) {
  const isPresent = list.includes(videoId);
  if (isPresent === isListed) {
    return null;
  }

  return isListed ? [...list, videoId] : list.filter(id => id !== videoId);
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
  const isQueueChanged = filteredQueue.length !== queue.length;
  if (isQueueChanged) {
    writes.push(videoQueueItem.setValue(filteredQueue));
  }

  const isMusicChanged = filteredMusic.length !== musicList.length;
  if (isMusicChanged) {
    writes.push(musicListItem.setValue(filteredMusic));
  }

  const isVideoOnlyChanged = filteredVideoOnly.length !== videoOnlyList.length;
  if (isVideoOnlyChanged) {
    writes.push(videoOnlyListItem.setValue(filteredVideoOnly));
  }

  let isDetailsRemoved = false;
  for (const id of videoIdsToRemove) {
    if (id in details) {
      delete details[id];
      isDetailsRemoved = true;
    }
  }

  if (isDetailsRemoved) {
    writes.push(videoDetailsItem.setValue(details));
  }

  await Promise.all(writes);
}

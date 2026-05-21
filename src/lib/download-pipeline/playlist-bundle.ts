import { triggerDownload } from ".";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { getCompatibleFilename } from "@/lib/utils/containers";
import { zip } from "fflate";
import type { AsyncZippable } from "fflate";

const playlistBundles = new Map<string, {
  playlistTitle: string;
  totalCount: number;
  files: Map<string, {
    filename: string;
    data: Uint8Array;
  }>;
  tabId: number;
}>();

function zipToBuffer(entries: AsyncZippable) {
  return new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, (error, data) => {
      if (error) {
        reject(error);
      } else {
        resolve(data);
      }
    });
  });
}

export function notifyPlaylistBundleFailure(playlistId: string) {
  playlistBundles.delete(playlistId);
}

type AddToPlaylistBundleParams = {
  playlistId: string;
  playlistTitle: string;
  totalCount: number;
  tabId: number;
  filename: string;
  data: Uint8Array;
};
export async function addToPlaylistBundle({
  playlistId, playlistTitle, totalCount, tabId, filename, data
}: AddToPlaylistBundleParams) {
  const isBundleNew = !playlistBundles.has(playlistId);
  if (isBundleNew) {
    playlistBundles.set(playlistId, {
      playlistTitle,
      totalCount,
      files: new Map(),
      tabId
    });
  }

  const bundle = playlistBundles.get(playlistId);
  const isBundleMissing = !bundle;
  if (isBundleMissing) {
    return;
  }

  const isBundleStale = bundle.totalCount !== totalCount;
  if (isBundleStale) {
    bundle.files.clear();
    bundle.totalCount = totalCount;
    bundle.playlistTitle = playlistTitle;
    bundle.tabId = tabId;
  }

  bundle.files.set(filename, {
    filename,
    data
  });

  const isBundleIncomplete = bundle.files.size < bundle.totalCount;
  if (isBundleIncomplete) {
    return;
  }

  const zipEntries: AsyncZippable = {};
  for (const [, file] of bundle.files) {
    zipEntries[file.filename] = [file.data, { level: 0 }];
  }

  const zipFilename = getCompatibleFilename(`${bundle.playlistTitle}.zip`);
  playlistBundles.delete(playlistId);

  await sendMessage(MessageType.PipelineZipProgress, {
    playlistId,
    isDone: false,
    tabId: bundle.tabId
  });

  try {
    await triggerDownload({
      data: await zipToBuffer(zipEntries),
      filenameOutput: zipFilename,
      recentContext: {
        videoId: playlistId,
        title: bundle.playlistTitle,
        channel: `${bundle.totalCount} files`
      }
    });
  } finally {
    await sendMessage(MessageType.PipelineZipProgress, {
      playlistId,
      isDone: true,
      tabId: bundle.tabId
    });
  }
}

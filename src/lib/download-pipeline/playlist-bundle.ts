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

export async function addToPlaylistBundle({
  playlistId, playlistTitle, totalCount, tabId, filename, data
}: {
  playlistId: string;
  playlistTitle: string;
  totalCount: number;
  tabId: number;
  filename: string;
  data: Uint8Array;
}) {
  if (!playlistBundles.has(playlistId)) {
    playlistBundles.set(playlistId, {
      playlistTitle,
      totalCount,
      files: new Map(),
      tabId
    });
  }

  const bundle = playlistBundles.get(playlistId);
  if (!bundle) {
    return;
  }

  if (bundle.totalCount !== totalCount) {
    bundle.files.clear();
    bundle.totalCount = totalCount;
    bundle.playlistTitle = playlistTitle;
    bundle.tabId = tabId;
  }

  bundle.files.set(filename, {
    filename,
    data
  });

  if (bundle.files.size < bundle.totalCount) {
    return;
  }

  const zipEntries: AsyncZippable = {};
  for (const file of bundle.files.values()) {
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
    const zipped = await zipToBuffer(zipEntries);
    await triggerDownload({
      data: zipped,
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

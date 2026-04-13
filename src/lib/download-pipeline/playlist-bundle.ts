import { triggerDownload } from ".";
import { getCompatibleFilename } from "../containers";
import { zipSync } from "fflate";

const playlistBundles = new Map<string, {
  playlistTitle: string;
  totalCount: number;
  files: Map<string, {
    filename: string;
    data: Uint8Array;
  }>;
  tabId: number;
}>();

export function addToPlaylistBundle({
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

  const bundle = playlistBundles.get(playlistId)!;
  bundle.files.set(filename, { filename, data });

  if (bundle.files.size < bundle.totalCount) {
    return;
  }

  const zipEntries: Record<string, Uint8Array> = {};
  for (const [, file] of bundle.files) {
    zipEntries[file.filename] = file.data;
  }

  const zipped = zipSync(zipEntries);
  const zipFilename = getCompatibleFilename(`${bundle.playlistTitle}.zip`);
  playlistBundles.delete(playlistId);

  void triggerDownload(zipped, zipFilename);
}

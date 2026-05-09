import { triggerDownload } from ".";
import { runTranscodeFile } from "./ffmpeg-instance";
import { getRecentDownloadBlob, getAllRecentDownloads } from "@/lib/storage/recent-downloads-db";

function swapFileExtension({ filename, extension }: {
  filename: string;
  extension: string;
}) {
  const iDot = filename.lastIndexOf(".");
  const base = iDot === -1 ? filename : filename.slice(0, iDot);
  return `${base}.${extension}`;
}

export async function transcodeRecentDownload({ entryId, targetContainer }: {
  entryId: string;
  targetContainer: string;
}) {
  const allEntries = await getAllRecentDownloads();
  const entry = allEntries.find(item => item.id === entryId);
  if (!entry) {
    console.warn("[ytdl:transcode] Entry not found:", entryId);
    return;
  }

  const blob = await getRecentDownloadBlob(entryId);
  if (!blob) {
    console.warn("[ytdl:transcode] Blob not found:", entryId);
    return;
  }

  const downloadFilename = swapFileExtension({
    filename: entry.filename,
    extension: targetContainer
  });
  const inputBytes = await blob.arrayBuffer();

  const output = await runTranscodeFile(`transcode:${entryId}`, {
    data: inputBytes,
    sourceExtension: entry.container,
    targetContainer
  });
  if (!output) {
    throw new Error("FFmpeg returned no data for recent download transcode");
  }

  await triggerDownload({
    data: output,
    filenameOutput: downloadFilename,
    recentContext: {
      videoId: entry.videoId,
      title: entry.title,
      channel: entry.channel,
      thumbnailUrl: entry.thumbnailUrl
    }
  });
}

import { triggerDownload } from ".";
import { videoContainers } from "../containers";
import { getRecentDownloadBlob, getAllRecentDownloads } from "../recent-downloads-db";
import { enqueueMuxJob, getFFmpeg } from "./ffmpeg-instance";
import type { RecentDownloadEntry } from "@/types";

function swapFileExtension(filename: string, extension: string) {
  const dotIndex = filename.lastIndexOf(".");
  const base = dotIndex === -1 ? filename : filename.slice(0, dotIndex);
  return `${base}.${extension}`;
}

function buildFfmpegArgs(sourceFilename: string, outputFilename: string, targetContainer: string) {
  const args = ["-i", sourceFilename];
  if (videoContainers.includes(targetContainer)) {
    args.push("-c:v", "copy", "-c:a", "copy");
  }

  args.push(outputFilename);
  return args;
}

export async function transcodeRecentDownload({ entryId, targetContainer }: {
  entryId: string;
  targetContainer: string;
}) {
  const allEntries = await getAllRecentDownloads();
  const entry: RecentDownloadEntry | undefined = allEntries.find(item => item.id === entryId);
  if (!entry) {
    console.warn("[ytdl:transcode] Entry not found:", entryId);
    return;
  }

  const blob = await getRecentDownloadBlob(entryId);
  if (!blob) {
    console.warn("[ytdl:transcode] Blob not found:", entryId);
    return;
  }

  const sourceFilename = `source.${entry.container}`;
  const outputFilename = `output.${targetContainer}`;
  const downloadFilename = swapFileExtension(entry.filename, targetContainer);
  const inputBytes = new Uint8Array(await blob.arrayBuffer());

  await enqueueMuxJob(async () => {
    const ffmpeg = getFFmpeg();

    try {
      ffmpeg.FS.writeFile(sourceFilename, inputBytes);

      const exitCode = ffmpeg.exec(...buildFfmpegArgs(sourceFilename, outputFilename, targetContainer));
      if (exitCode !== 0) {
        throw new Error(`FFmpeg exited with code ${exitCode}`);
      }

      const output = ffmpeg.FS.readFile(outputFilename, { encoding: "binary" });
      if (typeof output === "string") {
        throw new Error("FFmpeg readFile returned unexpected string output");
      }

      await triggerDownload(output, downloadFilename, {
        videoId: entry.videoId,
        title: entry.title,
        channel: entry.channel,
        thumbnailUrl: entry.thumbnailUrl
      });
    } finally {
      try {
        ffmpeg.FS.unlink(sourceFilename);
      } catch { /* file may not exist */ }
      try {
        ffmpeg.FS.unlink(outputFilename);
      } catch { /* file may not exist */ }
    }
  });
}

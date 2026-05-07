import { triggerDownload } from ".";
import { enqueueMuxJob, getFFmpeg, tryUnlink } from "./ffmpeg-instance";
import { getRecentDownloadBlob, getAllRecentDownloads } from "@/lib/storage/recent-downloads-db";
import { videoContainers } from "@/lib/utils/containers";

function swapFileExtension({ filename, extension }: {
  filename: string;
  extension: string;
}) {
  const iDot = filename.lastIndexOf(".");
  const base = iDot === -1 ? filename : filename.slice(0, iDot);
  return `${base}.${extension}`;
}

function buildFfmpegArgs({ sourceFilename, outputFilename, targetContainer }: {
  sourceFilename: string;
  outputFilename: string;
  targetContainer: string;
}) {
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

  const sourceFilename = `source.${entry.container}`;
  const outputFilename = `output.${targetContainer}`;
  const downloadFilename = swapFileExtension({
    filename: entry.filename,
    extension: targetContainer
  });
  const inputBytes = new Uint8Array(await blob.arrayBuffer());

  await enqueueMuxJob(async () => {
    const ffmpeg = getFFmpeg();

    try {
      await ffmpeg.FS.writeFile(sourceFilename, inputBytes);

      const exitCode = await ffmpeg.exec(
        ...buildFfmpegArgs({
          sourceFilename,
          outputFilename,
          targetContainer
        })
      );
      if (exitCode !== 0) {
        throw new Error(`FFmpeg exited with code ${exitCode}`);
      }

      const output = await ffmpeg.FS.readFile(outputFilename);

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
    } finally {
      tryUnlink(sourceFilename);
      tryUnlink(outputFilename);
    }
  });
}

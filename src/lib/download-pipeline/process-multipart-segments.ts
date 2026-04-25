import { triggerDownload, reportProgress } from ".";
import { getFFmpeg, progressHandlers, tryUnlink } from "./ffmpeg-instance";
import { concatFmp4Segments } from "./fmp4-concat";
import { getCompatibleFilename } from "@/lib/utils/containers";
import { ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

// fMP4 segments share an init box (ftyp + moov) followed by fragments
// (moof + mdat). Since every scrub tab pulls the same itag, every segment's
// init is equivalent — keeping init only from segment 0 and concatenating
// the fragments from every segment yields a single valid fMP4 in one pass.
// FFmpeg then only needs ONE mux step (video.mp4 + audio.m4a → final),
// with -c copy and no MKV intermediate.
export async function processMultipartSegments(item: ProcessStreamData & { segments: NonNullable<ProcessStreamData["segments"]> }) {
  const { videoId, filenameOutput, videoMimeType, audioMimeType, tabId, segments } = item;
  const ffmpeg = getFFmpeg();

  const videoExt = videoMimeType.includes("webm") ? "webm" : "mp4";
  const audioExt = audioMimeType.includes("webm") ? "webm" : "m4a";
  const userExtension = (filenameOutput.split(".").pop() ?? "mp4").toLowerCase();
  const targetExtension = userExtension === "mkv" ? "mkv" : "mp4";

  const filenameBase = filenameOutput.replace(/\.[^.]+$/, "");
  const videoFilename = getCompatibleFilename(`${videoId}-video.${videoExt}`);
  const audioFilename = getCompatibleFilename(`${videoId}-audio.${audioExt}`);
  const outputFilename = getCompatibleFilename(`${videoId}-${filenameBase}.${targetExtension}`);

  function handleFFmpegProgress({ progress }: {
    progress: number;
  }) {
    void reportProgress({
      videoId,
      progress: Math.min(progress, 0.99),
      progressType: ProgressType.FFmpeg,
      tabId
    });
  }

  progressHandlers.add(handleFFmpegProgress);

  const writtenPaths: string[] = [];

  try {
    const usableSegments = segments.filter(segment =>
      segment.video.byteLength > 0 && segment.audio.byteLength > 0);
    if (usableSegments.length === 0) {
      throw new Error(`No usable segments captured for ${videoId}`);
    }

    const videoBytes = concatFmp4Segments(usableSegments.map(segment => segment.video));
    const audioBytes = concatFmp4Segments(usableSegments.map(segment => segment.audio));

    console.log(`[ytdl:pipeline] concatenated ${usableSegments.length}/${segments.length} segments for ${videoId} — video=${videoBytes.byteLength}B audio=${audioBytes.byteLength}B`);

    ffmpeg.FS.writeFile(videoFilename, videoBytes);
    ffmpeg.FS.writeFile(audioFilename, audioBytes);
    writtenPaths.push(videoFilename, audioFilename);

    const muxArgs = [
      "-i", videoFilename,
      "-i", audioFilename,
      "-map", "0:v:0", "-map", "1:a:0",
      "-c:v", "copy", "-c:a", "copy"
    ];
    if (targetExtension === "mp4") {
      muxArgs.push("-movflags", "+faststart");
    }

    muxArgs.push(outputFilename);

    const muxExit = ffmpeg.exec(...muxArgs);
    if (muxExit !== 0) {
      throw new Error(`FFmpeg mux failed with exit code ${muxExit}`);
    }

    writtenPaths.push(outputFilename);

    const outputBytes = ffmpeg.FS.readFile(outputFilename, { encoding: "binary" });
    if (typeof outputBytes === "string") {
      throw new Error("FFmpeg readFile returned unexpected string output");
    }

    const recentContext = {
      videoId,
      title: item.metadata?.title ?? filenameOutput,
      channel: item.metadata?.artist ?? "",
      thumbnailUrl: item.metadata?.thumbnailUrl
    };
    await triggerDownload({
      data: outputBytes,
      filenameOutput: `${filenameBase}.${targetExtension}`,
      recentContext
    });

    await reportProgress({
      videoId,
      progress: 1,
      progressType: ProgressType.FFmpeg,
      tabId
    });
  } finally {
    progressHandlers.delete(handleFFmpegProgress);
    for (const path of writtenPaths) {
      tryUnlink({
        ffmpeg,
        filename: path
      });
    }
  }
}

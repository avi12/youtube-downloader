import { triggerDownload, reportProgress } from ".";
import { getFFmpeg, progressHandlers, tryUnlink } from "./ffmpeg-instance";
import { getCompatibleFilename } from "@/lib/utils/containers";
import { ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

/**
 * Assemble an iframe-scrubbed video from N per-iframe segments.
 *
 * Each segment is an independent fMP4/WebM (the bytes one player iframe
 * appended to its MediaSource starting at a specific `t=N`). Naive concat
 * of the raw bytes fails: multiple `moov` boxes, fragments whose `tfdt`
 * decode times overlap at the seams.
 *
 * The fix is FFmpeg's concat demuxer + Matroska intermediate:
 *   1. Write each segment pair (video_i.mp4, audio_i.m4a) to the FFmpeg FS.
 *   2. Concat demuxer with `-c copy` merges them into a single MKV. MKV is
 *      tolerant of timestamp discontinuities + re-seating across segments
 *      where MP4's strict decode-time monotonicity would reject the output.
 *   3. If the user's target container is also MKV, that's the final file.
 *      If they asked for MP4, transcode MKV→MP4 with `-c copy` (stream-copy,
 *      no re-encode) to rewrite the timestamps under MP4's rules.
 */
export async function processMultipartSegments(item: ProcessStreamData & { segments: NonNullable<ProcessStreamData["segments"]> }) {
  const { videoId, filenameOutput, videoMimeType, audioMimeType, tabId, segments } = item;
  const ffmpeg = getFFmpeg();

  const videoExt = videoMimeType.includes("webm") ? "webm" : "mp4";
  const audioExt = audioMimeType.includes("webm") ? "webm" : "m4a";
  const userExtension = (filenameOutput.split(".").pop() ?? "mp4").toLowerCase();
  const targetExtension = userExtension === "mkv" ? "mkv" : "mp4";

  const filenameBase = filenameOutput.replace(/\.[^.]+$/, "");
  const intermediateFilename = getCompatibleFilename(`${videoId}-intermediate.mkv`);
  const outputFilename = getCompatibleFilename(`${videoId}-${filenameBase}.${targetExtension}`);

  function handleFFmpegProgress({ progress }: {
    progress: number;
  }) {
    const capped = Math.min(progress, 0.99);
    void reportProgress({
      videoId,
      progress: capped,
      progressType: ProgressType.FFmpeg,
      tabId
    });
  }

  progressHandlers.add(handleFFmpegProgress);

  const videoSegmentFiles: string[] = [];
  const audioSegmentFiles: string[] = [];
  const writtenPaths: string[] = [];

  function probeSegmentFile(filename: string) {
    return ffmpeg.exec("-v", "error", "-i", filename, "-f", "null", "-") === 0;
  }

  try {
    for (const [i, segment] of segments.entries()) {
      const videoName = `${videoId}-v${i}.${videoExt}`;
      const audioName = `${videoId}-a${i}.${audioExt}`;
      ffmpeg.FS.writeFile(videoName, segment.video);
      ffmpeg.FS.writeFile(audioName, segment.audio);
      videoSegmentFiles.push(videoName);
      audioSegmentFiles.push(audioName);
      writtenPaths.push(videoName, audioName);
    }

    // Drop segments whose video or audio FFmpeg can't decode — one bad pair
    // would otherwise abort the concat demuxer and lose the whole file.
    const passingVideoFiles: string[] = [];
    const passingAudioFiles: string[] = [];
    for (let i = 0; i < videoSegmentFiles.length; i++) {
      if (probeSegmentFile(videoSegmentFiles[i]) && probeSegmentFile(audioSegmentFiles[i])) {
        passingVideoFiles.push(videoSegmentFiles[i]);
        passingAudioFiles.push(audioSegmentFiles[i]);
      } else {
        console.warn(`[ytdl:pipeline] dropping unmuxable segment ${i} for ${videoId}`);
      }
    }

    if (passingVideoFiles.length === 0) {
      throw new Error("All segments failed the FFmpeg probe; nothing to mux");
    }

    console.log(`[ytdl:pipeline] muxing ${passingVideoFiles.length}/${segments.length} segments for ${videoId}`);

    const videoListName = `${videoId}-video-concat.txt`;
    const audioListName = `${videoId}-audio-concat.txt`;
    const encoder = new TextEncoder();
    ffmpeg.FS.writeFile(
      videoListName, encoder.encode(
        passingVideoFiles.map(name => `file '${name}'`).join("\n") + "\n"
      )
    );
    ffmpeg.FS.writeFile(
      audioListName, encoder.encode(
        passingAudioFiles.map(name => `file '${name}'`).join("\n") + "\n"
      )
    );
    writtenPaths.push(videoListName, audioListName);

    // Phase 1: concat all segments into a single MKV, stream-copy (no re-encode).
    const concatArgs = [
      "-f", "concat", "-safe", "0", "-i", videoListName,
      "-f", "concat", "-safe", "0", "-i", audioListName,
      "-map", "0:v:0", "-map", "1:a:0",
      "-c:v", "copy", "-c:a", "copy",
      intermediateFilename
    ];
    const concatExit = ffmpeg.exec(...concatArgs);
    if (concatExit !== 0) {
      throw new Error(`FFmpeg concat failed with exit code ${concatExit}`);
    }

    writtenPaths.push(intermediateFilename);

    // Phase 2: optional MKV→MP4 stream-copy when the user asked for MP4.
    let finalFilename = intermediateFilename;
    if (targetExtension === "mp4") {
      const transcodeArgs = [
        "-i", intermediateFilename,
        "-c:v", "copy", "-c:a", "copy",
        "-movflags", "+faststart",
        outputFilename
      ];
      const transcodeExit = ffmpeg.exec(...transcodeArgs);
      if (transcodeExit !== 0) {
        throw new Error(`FFmpeg MKV→MP4 transcode failed with exit code ${transcodeExit}`);
      }

      finalFilename = outputFilename;
      writtenPaths.push(outputFilename);
    } else {
      // MKV target — rename intermediate to output so the cleanup path unlinks it.
      finalFilename = intermediateFilename;
    }

    const outputBytes = ffmpeg.FS.readFile(finalFilename, { encoding: "binary" });
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

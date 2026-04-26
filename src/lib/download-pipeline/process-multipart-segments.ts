import { triggerDownload, reportProgress } from ".";
import { getFFmpeg, progressHandlers, tryUnlink } from "./ffmpeg-instance";
import { getCompatibleFilename } from "@/lib/utils/containers";
import { ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

// Single ffmpeg pass: concat demuxer reads the per-iframe segment files
// directly into the user's target container. No intermediate MKV, no
// per-segment pre-mux. Each segment is its own self-contained fMP4 (init +
// fragments), which the concat demuxer handles correctly even when
// consecutive segments have different itags / codec params.
//
// MP4 output uses `-avoid_negative_ts make_zero` because the captured
// fragments' tfdt timestamps reset across iframe boundaries; MP4's strict
// decode-time monotonicity would reject those without the flag.
//
// 4 GB WASM heap budget: the FS holds N segment inputs + 1 output
// simultaneously (~2× total media bytes). For 1-hour videos at typical
// bitrate that's well under 4 GB.
export async function processMultipartSegments(item: ProcessStreamData & { segments: NonNullable<ProcessStreamData["segments"]> }) {
  const { videoId, filenameOutput, videoMimeType, audioMimeType, tabId, segments } = item;
  const ffmpeg = getFFmpeg();

  const videoExt = videoMimeType.includes("webm") ? "webm" : "mp4";
  const audioExt = audioMimeType.includes("webm") ? "webm" : "m4a";
  const userExtension = (filenameOutput.split(".").pop() ?? "mp4").toLowerCase();
  const targetExtension = userExtension === "mkv" ? "mkv" : "mp4";

  const filenameBase = filenameOutput.replace(/\.[^.]+$/, "");
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
    const videoSegmentFiles: string[] = [];
    const audioSegmentFiles: string[] = [];
    for (const [i, segment] of segments.entries()) {
      if (segment.video.byteLength === 0 || segment.audio.byteLength === 0) {
        continue;
      }

      const videoName = `${videoId}-v${i}.${videoExt}`;
      const audioName = `${videoId}-a${i}.${audioExt}`;
      ffmpeg.FS.writeFile(videoName, segment.video);
      ffmpeg.FS.writeFile(audioName, segment.audio);
      videoSegmentFiles.push(videoName);
      audioSegmentFiles.push(audioName);
      writtenPaths.push(videoName, audioName);
    }

    if (videoSegmentFiles.length === 0) {
      throw new Error("No usable segments to mux");
    }

    console.log(`[ytdl:pipeline] muxing ${videoSegmentFiles.length}/${segments.length} segments for ${videoId} → ${targetExtension}`);

    const videoListName = `${videoId}-video-concat.txt`;
    const audioListName = `${videoId}-audio-concat.txt`;
    const encoder = new TextEncoder();
    ffmpeg.FS.writeFile(
      videoListName, encoder.encode(
        videoSegmentFiles.map(name => `file '${name}'`).join("\n") + "\n"
      )
    );
    ffmpeg.FS.writeFile(
      audioListName, encoder.encode(
        audioSegmentFiles.map(name => `file '${name}'`).join("\n") + "\n"
      )
    );
    writtenPaths.push(videoListName, audioListName);

    // MKV intermediate, then stream-copy to user's target. MKV tolerates the
    // timestamp re-seats and codec-param differences across iframe segments
    // that strict MP4 muxing rejects with exit code 1. Single-pass concat
    // straight to MP4 was failing on segment-to-segment itag changes (player
    // ABR adapts across iframe loads).
    const intermediateFilename = `${videoId}-intermediate.mkv`;
    const intermediateArgs = [
      "-f", "concat", "-safe", "0", "-i", videoListName,
      "-f", "concat", "-safe", "0", "-i", audioListName,
      "-map", "0:v:0", "-map", "1:a:0",
      "-c:v", "copy", "-c:a", "copy",
      "-fflags", "+genpts+discardcorrupt",
      "-err_detect", "ignore_err",
      intermediateFilename
    ];

    const intermediateExit = ffmpeg.exec(...intermediateArgs);
    if (intermediateExit !== 0) {
      throw new Error(`FFmpeg MKV mux failed with exit code ${intermediateExit}`);
    }

    writtenPaths.push(intermediateFilename);

    if (targetExtension === "mkv") {
      const outputBytes = ffmpeg.FS.readFile(intermediateFilename, { encoding: "binary" });
      if (typeof outputBytes === "string") {
        throw new Error("FFmpeg readFile returned unexpected string output");
      }
      writtenPaths.push(outputFilename);
      const recentContextMkv = {
        videoId,
        title: item.metadata?.title ?? filenameOutput,
        channel: item.metadata?.artist ?? "",
        thumbnailUrl: item.metadata?.thumbnailUrl
      };
      await triggerDownload({
        data: outputBytes,
        filenameOutput: `${filenameBase}.mkv`,
        recentContext: recentContextMkv
      });
      return;
    }

    // MKV → MP4 stream-copy (no re-encode; MKV's normalized timestamps make
    // MP4's strict decode-time monotonicity satisfiable).
    const targetArgs = [
      "-i", intermediateFilename,
      "-c:v", "copy", "-c:a", "copy",
      "-movflags", "+faststart",
      outputFilename
    ];
    const targetExit = ffmpeg.exec(...targetArgs);
    if (targetExit !== 0) {
      throw new Error(`FFmpeg MP4 transcode failed with exit code ${targetExit}`);
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

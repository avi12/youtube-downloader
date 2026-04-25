import { triggerDownload, reportProgress } from ".";
import { getFFmpeg, progressHandlers, tryUnlink } from "./ffmpeg-instance";
import { getCompatibleFilename } from "@/lib/utils/containers";
import { ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

// Each scrub-tab segment is a self-contained fMP4 (its own init + fragments),
// but YouTube's adaptive itag selection means consecutive scrub tabs may have
// different resolutions / bitrates / codec params. Naive byte-concat with one
// shared init breaks for those, so we use FFmpeg's concat demuxer with an MKV
// intermediate (timestamps tolerate per-segment discontinuity), then optional
// MKV→MP4 stream-copy with +faststart. Segments that fail an FFmpeg probe are
// dropped from the concat list so a single bad segment doesn't kill the file.
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
    void reportProgress({
      videoId,
      progress: Math.min(progress, 0.99),
      progressType: ProgressType.FFmpeg,
      tabId
    });
  }

  progressHandlers.add(handleFFmpegProgress);

  const writtenPaths: string[] = [];

  function probeSegmentFile(filename: string) {
    return ffmpeg.exec("-v", "error", "-i", filename, "-f", "null", "-") === 0;
  }

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

    // Free segment inputs from the WASM FS before the MP4 transcode — keeping
    // ~150 MB of inputs + the new ~150 MB intermediate + the ~150 MB output
    // would blow past the FFmpeg WASM heap.
    for (const segmentPath of [...videoSegmentFiles, ...audioSegmentFiles, videoListName, audioListName]) {
      tryUnlink({
        ffmpeg,
        filename: segmentPath
      });
    }
    writtenPaths.length = 0;
    writtenPaths.push(intermediateFilename);

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

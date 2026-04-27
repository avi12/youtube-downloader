import { toUint8Array, triggerDownload, reportProgress } from ".";
import { getFFmpeg, progressHandlers, tryUnlink } from "./ffmpeg-instance";
import { broadcastDebugLogToYouTubeTabs } from "@/lib/messaging/debug-log";
import { getCompatibleFilename } from "@/lib/utils/containers";
import { ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

function logPipelineEvent(message: string) {
  void broadcastDebugLogToYouTubeTabs(message);
}

// FFmpeg WASM is 32-bit and capped at 4 GB of total memory. Long-video
// downloads can easily produce 1-2 GB of segment bytes, and a naive pipeline
// (write all inputs, run concat, write intermediate, transcode) doubles or
// triples that. So we pre-mux each (video_i, audio_i) pair into a single
// segment_i.mkv as soon as it's written and immediately unlink the inputs;
// the final concat then reads only the small per-segment MKVs.
//
// Peak FS usage at any one moment:
//   - 1 video + 1 audio (one segment, ≤ ~30 MB)
//   - All previously-muxed segment_i.mkv files (~equal to total media bytes)
//   - Final concat output (~equal to total media bytes)
// Two segment-equivalents instead of three, well under 4 GB for normal videos.
//
// A failed pre-mux for a single segment drops it (acts as the probe-and-skip);
// the final concat still uses the survivors.
// Multipart segments come straight from the YouTube player's SourceBuffer.
// VP9 video buffers start at the nearest keyframe before the seek target
// (videoBufferStartSec <= N*step). FFmpeg's MKV muxer normalizes timestamps
// so each per-segment file has video PTS starting at 0 and audio PTS starting
// at prerollSec (= startSec - videoBufferStartSec). The concat list uses
// inpoint=prerollSec / outpoint=prerollSec+stepSec so the concat demuxer
// discards the video preroll and each segment contributes exactly stepSec —
// no re-encode, no duration inflation.
// MKV preserves the original codecs (Opus audio, VP9 video) without a
// transcode. MP4 would require Opus→AAC re-encoding which is slow and lossy.
const MULTIPART_TARGET_EXTENSION = "mkv";

export async function processMultipartSegments(item: ProcessStreamData & { segments: NonNullable<ProcessStreamData["segments"]> }) {
  const {
    videoId, filenameOutput, videoMimeType, audioMimeType, tabId, segments,
    additionalAudioStreams, subtitleStreams, primaryAudioLabel, segmentDurationSec
  } = item;
  const ffmpeg = getFFmpeg();

  const videoExt = videoMimeType.includes("webm") ? "webm" : "mp4";
  const audioExt = audioMimeType.includes("webm") ? "webm" : "m4a";
  const extraAudioWritten = additionalAudioStreams.filter(stream => Boolean(toUint8Array(stream.data)));
  const hasExtras = extraAudioWritten.length > 0 || subtitleStreams.length > 0;

  const filenameBase = filenameOutput.replace(/\.[^.]+$/, "");
  const intermediateFilename = getCompatibleFilename(`${videoId}-intermediate.mkv`);
  const outputFilename = getCompatibleFilename(`${videoId}-${filenameBase}.${MULTIPART_TARGET_EXTENSION}`);

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

  function muxSinglePair({ index, segment }: {
    index: number;
    segment: ProcessStreamData["segments"] extends infer T ? T extends Array<infer S> ? S : never : never;
  }) {
    if (!segment || segment.video.byteLength === 0 || segment.audio.byteLength === 0) {
      return null;
    }

    const videoName = `${videoId}-v${index}.${videoExt}`;
    const audioName = `${videoId}-a${index}.${audioExt}`;
    const segmentMkv = `${videoId}-seg${index}.mkv`;

    ffmpeg.FS.writeFile(videoName, segment.video);
    ffmpeg.FS.writeFile(audioName, segment.audio);

    const startSec = index * (segmentDurationSec ?? 0);
    const rawPreroll = segment.videoBufferStartSec !== undefined && segment.videoBufferStartSec < startSec
      ? startSec - segment.videoBufferStartSec
      : 0;
    // videoBufferStartSec=0 on a non-zero startSec means the capture hook read
    // the init-segment timestamp before the first media segment arrived. A real
    // VP9 keyframe preroll is always < segmentDurationSec; anything larger is
    // corrupt data — treat as no preroll so inpoint/outpoint stay sane.
    const prerollSec = segmentDurationSec && rawPreroll >= segmentDurationSec ? 0 : rawPreroll;
    logPipelineEvent(`[ytdl:pipeline] segment ${index} videoBufferStartSec=${segment.videoBufferStartSec ?? "undefined"} startSec=${startSec} prerollSec=${prerollSec}`);
    // -t caps pre-mux output so the player's buffer-ahead overshoot doesn't
    // add extra frames. VP9 preroll is stripped later by inpoint/outpoint in
    // the concat list (PTS-based trim, no re-encode needed).
    const trimArgs = segmentDurationSec
      ? ["-t", String(segmentDurationSec + prerollSec)]
      : [];
    let exitCode = ffmpeg.exec(
      "-y", "-i", videoName, "-i", audioName, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "copy", ...trimArgs, segmentMkv
    );
    // Retry: drop trim as last resort (segment may be slightly short).
    if (exitCode !== 0 && trimArgs.length > 0) {
      logPipelineEvent(`[ytdl:pipeline] segment ${index} mux retry without trim`);
      exitCode = ffmpeg.exec(
        "-y", "-i", videoName, "-i", audioName, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "copy", segmentMkv
      );
    }

    tryUnlink({
      ffmpeg,
      filename: videoName
    });
    tryUnlink({
      ffmpeg,
      filename: audioName
    });

    if (exitCode !== 0) {
      tryUnlink({
        ffmpeg,
        filename: segmentMkv
      });
      logPipelineEvent(`[ytdl:pipeline] segment ${index} mux failed (exit ${exitCode}) v=${segment.video.byteLength}B a=${segment.audio.byteLength}B`);
      return null;
    }

    return {
      filename: segmentMkv,
      prerollSec
    };
  }

  try {
    const segmentMkvFiles: Array<{
      filename: string;
      prerollSec: number;
    }> = [];
    for (const [index, segment] of segments.entries()) {
      const muxed = muxSinglePair({
        index,
        segment
      });
      if (muxed) {
        segmentMkvFiles.push(muxed);
        writtenPaths.push(muxed.filename);
      }
    }

    if (segmentMkvFiles.length === 0) {
      throw new Error("All segments failed pre-mux; nothing to concat");
    }

    logPipelineEvent(`[ytdl:pipeline] concatenating ${segmentMkvFiles.length}/${segments.length} muxed segments for ${videoId}`);

    const concatListName = `${videoId}-concat.txt`;
    const encoder = new TextEncoder();
    // FFmpeg's MKV muxer normalizes timestamps to start from 0 per file.
    // So each segment's video starts at PTS 0 (not videoBufferStartSec) and
    // audio starts at PTS prerollSec (= startSec - videoBufferStartSec).
    // inpoint/outpoint must reference these normalized positions:
    //   inpoint  = prerollSec  (skip video preroll; audio starts exactly here)
    //   outpoint = prerollSec + segmentDurationSec
    // Contribution = segmentDurationSec per segment, total = K*stepSec.
    const concatLines = segmentMkvFiles.flatMap(({ filename, prerollSec: segPreroll }) => {
      const lines = [`file '${filename}'`];
      if (segmentDurationSec) {
        lines.push(`inpoint ${segPreroll}`);
        lines.push(`outpoint ${segPreroll + segmentDurationSec}`);
      }

      return lines;
    });
    ffmpeg.FS.writeFile(
      concatListName, encoder.encode(concatLines.join("\n") + "\n")
    );
    writtenPaths.push(concatListName);

    const concatExit = ffmpeg.exec(
      "-f", "concat", "-safe", "0", "-i", concatListName, "-c", "copy", intermediateFilename
    );
    if (concatExit !== 0) {
      throw new Error(`FFmpeg concat failed with exit code ${concatExit}`);
    }

    writtenPaths.push(intermediateFilename);

    for (const { filename: segMkv } of segmentMkvFiles) {
      tryUnlink({
        ffmpeg,
        filename: segMkv
      });
    }
    tryUnlink({
      ffmpeg,
      filename: concatListName
    });
    writtenPaths.length = 0;
    writtenPaths.push(intermediateFilename);

    let finalFilename = intermediateFilename;
    if (hasExtras) {
      const muxArgs: string[] = ["-i", intermediateFilename];
      const extraAudioInputs: {
        filename: string;
        label: string;
      }[] = [];
      const subtitleInputs: {
        filename: string;
        languageCode: string;
        label: string;
      }[] = [];

      for (const [iAudio, stream] of extraAudioWritten.entries()) {
        const data = toUint8Array(stream.data);
        if (!data) {
          continue;
        }

        const ext = stream.mimeType.includes("webm") ? "webm" : "m4a";
        const extraName = `${videoId}-extra-audio-${iAudio}.${ext}`;
        ffmpeg.FS.writeFile(extraName, data);
        writtenPaths.push(extraName);
        muxArgs.push("-i", extraName);
        extraAudioInputs.push({
          filename: extraName,
          label: stream.label
        });
      }

      for (const [iSub, sub] of subtitleStreams.entries()) {
        const subName = `${videoId}-sub-${iSub}.srt`;
        ffmpeg.FS.writeFile(subName, new TextEncoder().encode(sub.srtContent));
        writtenPaths.push(subName);
        muxArgs.push("-i", subName);
        subtitleInputs.push({
          filename: subName,
          languageCode: sub.languageCode,
          label: sub.label
        });
      }

      muxArgs.push("-map", "0:v:0", "-map", "0:a:0");
      for (let i = 0; i < extraAudioInputs.length; i++) {
        muxArgs.push("-map", `${i + 1}:a:0`);
      }

      const subtitleOffset = 1 + extraAudioInputs.length;
      for (let i = 0; i < subtitleInputs.length; i++) {
        muxArgs.push("-map", `${subtitleOffset + i}:s:0`);
      }

      muxArgs.push("-c:v", "copy", "-c:a", "copy");

      if (subtitleInputs.length > 0) {
        muxArgs.push("-c:s", "srt");
      }

      const audioLabels = [primaryAudioLabel ?? "", ...extraAudioInputs.map(input => input.label)];
      for (const [i, label] of audioLabels.entries()) {
        if (label) {
          muxArgs.push(`-metadata:s:a:${i}`, `title=${label}`);
        }
      }

      for (const [i, sub] of subtitleInputs.entries()) {
        muxArgs.push(`-metadata:s:s:${i}`, `language=${sub.languageCode}`);

        if (sub.label) {
          muxArgs.push(`-metadata:s:s:${i}`, `title=${sub.label}`);
        }
      }

      muxArgs.push(outputFilename);

      const muxExit = ffmpeg.exec(...muxArgs);
      if (muxExit !== 0) {
        throw new Error(`FFmpeg multi-track mux failed with exit code ${muxExit}`);
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
      filenameOutput: `${filenameBase}.${MULTIPART_TARGET_EXTENSION}`,
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

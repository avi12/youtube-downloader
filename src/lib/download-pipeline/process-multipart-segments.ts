import { toUint8Array, triggerDownload, reportProgress } from ".";
import { getFFmpeg, progressHandlers, tryUnlink } from "./ffmpeg-instance";
import { getCompatibleFilename } from "@/lib/utils/containers";
import { ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

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
function pickMultipartTargetExtension({ hasExtras, userExtension }: {
  hasExtras: boolean;
  userExtension: string;
}) {
  if (hasExtras) {
    return "mkv";
  }

  return userExtension === "mkv" ? "mkv" : "mp4";
}

export async function processMultipartSegments(item: ProcessStreamData & { segments: NonNullable<ProcessStreamData["segments"]> }) {
  const {
    videoId, filenameOutput, videoMimeType, audioMimeType, tabId, segments,
    additionalAudioStreams, subtitleStreams, primaryAudioLabel
  } = item;
  const ffmpeg = getFFmpeg();

  const videoExt = videoMimeType.includes("webm") ? "webm" : "mp4";
  const audioExt = audioMimeType.includes("webm") ? "webm" : "m4a";
  const userExtension = (filenameOutput.split(".").pop() ?? "mkv").toLowerCase();
  const extraAudioWritten = additionalAudioStreams.filter(stream => Boolean(toUint8Array(stream.data)));
  const hasExtras = extraAudioWritten.length > 0 || subtitleStreams.length > 0;
  // MP4 doesn't carry SRT subtitles or arbitrary multi-audio cleanly, so any
  // extras force MKV — matches processVideoAudio's behavior and gives VLC
  // independent track selection.
  const targetExtension = pickMultipartTargetExtension({
    hasExtras,
    userExtension
  });

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

    const exitCode = ffmpeg.exec(
      "-i", videoName, "-i", audioName, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "copy", segmentMkv
    );

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
      console.warn(`[ytdl:pipeline] segment ${index} mux failed (exit ${exitCode}), dropping`);
      return null;
    }

    return segmentMkv;
  }

  try {
    const segmentMkvFiles: string[] = [];
    for (const [index, segment] of segments.entries()) {
      const muxed = muxSinglePair({
        index,
        segment
      });
      if (muxed) {
        segmentMkvFiles.push(muxed);
        writtenPaths.push(muxed);
      }
    }

    if (segmentMkvFiles.length === 0) {
      throw new Error("All segments failed pre-mux; nothing to concat");
    }

    console.log(`[ytdl:pipeline] concatenating ${segmentMkvFiles.length}/${segments.length} muxed segments for ${videoId}`);

    const concatListName = `${videoId}-concat.txt`;
    const encoder = new TextEncoder();
    ffmpeg.FS.writeFile(
      concatListName, encoder.encode(
        segmentMkvFiles.map(name => `file '${name}'`).join("\n") + "\n"
      )
    );
    writtenPaths.push(concatListName);

    const concatExit = ffmpeg.exec(
      "-f", "concat", "-safe", "0", "-i", concatListName, "-c", "copy", intermediateFilename
    );
    if (concatExit !== 0) {
      throw new Error(`FFmpeg concat failed with exit code ${concatExit}`);
    }

    writtenPaths.push(intermediateFilename);

    for (const segMkv of segmentMkvFiles) {
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
    } else if (targetExtension === "mp4") {
      // MP4 only carries AAC reliably across consumer players (Windows Media
      // Player rejects Opus-in-MP4 outright); when the captured audio was
      // Opus-in-WebM, transcode it to AAC during this final pass instead of
      // stream-copying.
      const isOpusAudio = audioMimeType.includes("webm") || audioMimeType.includes("opus");
      const audioCodecArgs = isOpusAudio
        ? ["-c:a", "aac", "-b:a", "192k"]
        : ["-c:a", "copy"];
      const transcodeExit = ffmpeg.exec(
        "-i", intermediateFilename, "-c:v", "copy", ...audioCodecArgs, "-movflags", "+faststart", outputFilename
      );
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

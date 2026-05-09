import { toUint8Array, triggerDownload, reportProgress, FFMPEG_PROGRESS_CAP } from ".";
import { getFFmpeg, progressHandlers, tryUnlink } from "./ffmpeg-instance";
import { addToPlaylistBundle } from "./playlist-bundle";
import {
  CONTAINER_SPECS,
  extractBaseCodec,
  getAudioTempExtension,
  getCompatibleFilename,
  getVideoTempExtension,
  isVideoNativeForContainer
} from "@/lib/utils/containers";
import { AUDIO_EXTRA_STREAM_PREFIX, ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

function resolveSubtitleCodec(targetExtension: string) {
  return CONTAINER_SPECS[targetExtension]?.subtitleCodec ?? "webvtt";
}

function resolveAudioCodec(audioMimeType: string, targetExtension: string) {
  const spec = CONTAINER_SPECS[targetExtension];
  if (!spec) {
    return "copy";
  }

  const audioCodec = extractBaseCodec(audioMimeType);
  return spec.audioCodecs.has(audioCodec) ? "copy" : (spec.fallbackAudioCodec ?? "copy");
}

export async function processVideoAudio(item: ProcessStreamData, isCancelled: () => boolean) {
  const {
    videoId, filenameOutput, videoMimeType, audioMimeType, tabId, additionalAudioStreams,
    subtitleTracks
  } = item;

  const videoExtension = getVideoTempExtension(videoMimeType);
  const audioExtension = getAudioTempExtension(audioMimeType);
  const isExtraTracksPresent = Boolean(additionalAudioStreams.length);
  const filenameBase = filenameOutput.replace(/\.[^.]+$/, "");
  const targetExtension = isExtraTracksPresent ? "mkv" : (filenameOutput.split(".").pop() ?? "mkv");
  const downloadFilename = `${filenameBase}.${targetExtension}`;
  const videoFilename = `${videoId}-video.${videoExtension}`;
  const primaryAudioFilename = `${videoId}-audio.${audioExtension}`;
  const muxFilename = getCompatibleFilename(`${videoId}-mux.mkv`);
  const outputFilename = targetExtension !== "mkv"
    ? getCompatibleFilename(`${videoId}-${downloadFilename}`)
    : muxFilename;
  const ffmpeg = getFFmpeg();

  // When target isn't MKV and the video codec is natively supported by that container,
  // mux directly to the target format in one pass (no intermediate MKV needed).
  // Otherwise use a two-phase pipeline: stream-copy everything to a temp MKV first,
  // then remux/transcode to the target format.
  const isNativeToTarget = targetExtension === "mkv" || isVideoNativeForContainer(videoMimeType, targetExtension);
  const useIntermediateMkv = targetExtension !== "mkv" && !isNativeToTarget;

  let progressOffset = 0;
  let progressScale = useIntermediateMkv ? 0.5 : 1;

  function handleFFmpegProgress({ progress }: { progress: number }) {
    const scaled = progressOffset + progress * progressScale;
    const cappedProgress = Math.min(scaled, FFMPEG_PROGRESS_CAP);
    void reportProgress({
      videoId,
      progress: cappedProgress,
      progressType: ProgressType.FFmpeg,
      tabId
    });
  }

  progressHandlers.add(handleFFmpegProgress);

  const extraAudioTracks: {
    filename: string;
    label: string;
  }[] = [];
  const subtitleFiles: {
    filename: string;
    label: string;
    languageCode: string;
  }[] = [];

  try {
    {
      const videoData = toUint8Array(item.videoData);
      const audioData = toUint8Array(item.audioData);
      if (!videoData || !audioData) {
        const recentContext = {
          videoId,
          title: item.metadata?.title ?? filenameOutput,
          channel: item.metadata?.artist ?? "",
          thumbnailUrl: item.metadata?.thumbnailUrl
        };
        if (videoData) {
          await triggerDownload({
            data: videoData,
            filenameOutput,
            recentContext
          });
        } else if (audioData) {
          await triggerDownload({
            data: audioData,
            filenameOutput,
            recentContext
          });
        }

        await reportProgress({
          videoId,
          progress: 1,
          progressType: ProgressType.FFmpeg,
          tabId
        });

        return;
      }

      await reportProgress({
        videoId,
        progress: 0,
        progressType: ProgressType.FFmpeg,
        tabId
      });
      ffmpeg.FS.writeFile(videoFilename, videoData);
      ffmpeg.FS.writeFile(primaryAudioFilename, audioData);
    }

    for (const [i, stream] of additionalAudioStreams.entries()) {
      const extraData = toUint8Array(stream.data);
      if (!extraData) {
        continue;
      }

      const extraExtension = getAudioTempExtension(stream.mimeType);
      const extraFilename = `${videoId}-${AUDIO_EXTRA_STREAM_PREFIX}-${i}.${extraExtension}`;
      ffmpeg.FS.writeFile(extraFilename, extraData);
      extraAudioTracks.push({
        filename: extraFilename,
        label: stream.label
      });
    }

    for (const [i, track] of (subtitleTracks ?? []).entries()) {
      if (!track.data) {
        continue;
      }

      const subFilename = `${videoId}-sub-${i}.vtt`;
      ffmpeg.FS.writeFile(subFilename, track.data);
      subtitleFiles.push({
        filename: subFilename,
        label: track.label,
        languageCode: track.languageCode
      });
    }

    const ffmpegArgs = ["-i", videoFilename, "-i", primaryAudioFilename];
    for (const { filename } of extraAudioTracks) {
      ffmpegArgs.push("-i", filename);
    }
    for (const { filename } of subtitleFiles) {
      ffmpegArgs.push("-i", filename);
    }

    ffmpegArgs.push("-map", "0:v:0");
    for (let i = 0; i <= extraAudioTracks.length; i++) {
      ffmpegArgs.push("-map", `${i + 1}:a:0`);
    }
    const subtitleInputOffset = 2 + extraAudioTracks.length;
    for (let i = 0; i < subtitleFiles.length; i++) {
      ffmpegArgs.push("-map", `${subtitleInputOffset + i}:s:0`);
    }

    // When going directly to the target format, apply the audio/subtitle codecs in this pass.
    // When using an intermediate MKV, stream-copy everything — the second pass handles transcoding.
    const phase1AudioCodec = useIntermediateMkv ? "copy" : resolveAudioCodec(audioMimeType, targetExtension);
    const phase1SubtitleCodec = useIntermediateMkv ? "webvtt" : resolveSubtitleCodec(targetExtension);
    ffmpegArgs.push("-c:v", "copy", "-c:a", phase1AudioCodec);

    if (subtitleFiles.length > 0) {
      ffmpegArgs.push("-c:s", phase1SubtitleCodec);
    }

    const audioTrackLabels = [item.primaryAudioLabel ?? "", ...extraAudioTracks.map(track => track.label)];
    for (let i = 0; i < audioTrackLabels.length; i++) {
      const label = audioTrackLabels[i];
      if (label) {
        ffmpegArgs.push(`-metadata:s:a:${i}`, `title=${label}`);
      }
    }
    for (let i = 0; i < subtitleFiles.length; i++) {
      const { label, languageCode } = subtitleFiles[i];
      if (label) {
        ffmpegArgs.push(`-metadata:s:s:${i}`, `title=${label}`);
      }

      if (languageCode) {
        ffmpegArgs.push(`-metadata:s:s:${i}`, `language=${languageCode}`);
      }
    }

    const phase1Output = useIntermediateMkv ? muxFilename : outputFilename;
    ffmpegArgs.push(phase1Output);

    const muxExitCode = ffmpeg.exec(...ffmpegArgs);
    if (muxExitCode !== 0) {
      throw new Error(`FFmpeg exited with code ${muxExitCode}`);
    }

    if (useIntermediateMkv) {
      progressOffset = 0.5;
      progressScale = 0.5;
      const audioCodec = resolveAudioCodec(audioMimeType, targetExtension);
      const subtitleCodec = resolveSubtitleCodec(targetExtension);
      const phase2Args = ["-i", muxFilename, "-c:v", "copy", "-c:a", audioCodec];
      if (subtitleFiles.length > 0) {
        phase2Args.push("-c:s", subtitleCodec);
      }

      phase2Args.push(outputFilename);
      const transcodeExitCode = ffmpeg.exec(...phase2Args);
      if (transcodeExitCode !== 0) {
        throw new Error(`FFmpeg exited with code ${transcodeExitCode}`);
      }
    }

    if (isCancelled()) {
      return;
    }

    const ffmpegOutput = ffmpeg.FS.readFile(outputFilename, { encoding: "binary" });
    if (typeof ffmpegOutput === "string") {
      throw new Error("FFmpeg readFile returned unexpected string output");
    }

    if (item.playlistId) {
      await addToPlaylistBundle({
        playlistId: item.playlistId,
        playlistTitle: item.playlistTitle ?? "Playlist",
        totalCount: item.playlistTotalCount ?? 1,
        tabId,
        filename: downloadFilename,
        data: ffmpegOutput
      });
      await reportProgress({
        videoId,
        progress: 1,
        progressType: ProgressType.FFmpeg,
        tabId
      });
      return;
    }

    await triggerDownload({
      data: ffmpegOutput,
      filenameOutput: downloadFilename,
      recentContext: {
        videoId,
        title: item.metadata?.title ?? filenameOutput,
        channel: item.metadata?.artist ?? "",
        thumbnailUrl: item.metadata?.thumbnailUrl
      }
    });
    await reportProgress({
      videoId,
      progress: 1,
      progressType: ProgressType.FFmpeg,
      tabId
    });
  } finally {
    progressHandlers.delete(handleFFmpegProgress);
    tryUnlink({
      ffmpeg,
      filename: videoFilename
    });
    tryUnlink({
      ffmpeg,
      filename: primaryAudioFilename
    });

    if (useIntermediateMkv) {
      tryUnlink({
        ffmpeg,
        filename: muxFilename
      });
    }

    if (targetExtension !== "mkv") {
      tryUnlink({
        ffmpeg,
        filename: outputFilename
      });
    }

    for (const { filename } of extraAudioTracks) {
      tryUnlink({
        ffmpeg,
        filename
      });
    }

    for (const { filename } of subtitleFiles) {
      tryUnlink({
        ffmpeg,
        filename
      });
    }
  }
}

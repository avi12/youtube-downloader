import { toUint8Array, triggerDownload, reportProgress } from ".";
import { buildFfmpegArgs } from "./ffmpeg-args-builder";
import type { AudioTrackFile, SubtitleFile } from "./ffmpeg-args-builder";
import { getFFmpeg, progressHandlers, tryUnlink } from "./ffmpeg-instance";
import { addToPlaylistBundle } from "./playlist-bundle";
import { buildVideoAudioFilenames } from "./video-audio-filenames";
import { ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

export async function processVideoAudio(item: ProcessStreamData) {
  const {
    videoId, filenameOutput, videoMimeType, audioMimeType, tabId, additionalAudioStreams, subtitleStreams
  } = item;
  const isExtraTracksPresent = Boolean(additionalAudioStreams.length || subtitleStreams.length);
  const {
    videoFilename, primaryAudioFilename, outputFilename, downloadFilename, outputExtension
  } = buildVideoAudioFilenames({
    videoId,
    filenameOutput,
    videoMimeType,
    audioMimeType,
    isExtraTracksPresent
  });
  const ffmpeg = getFFmpeg();
  const ffmpegProgressCapBeforeSave = 0.99;

  function handleFFmpegProgress({ progress }: { progress: number }) {
    const cappedProgress = Math.min(progress, ffmpegProgressCapBeforeSave);
    void reportProgress({
      videoId,
      progress: cappedProgress,
      progressType: ProgressType.FFmpeg,
      tabId
    });
  }

  progressHandlers.add(handleFFmpegProgress);

  const extraAudioTracks: AudioTrackFile[] = [];
  const subtitleFiles: SubtitleFile[] = [];

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

      const extraExtension = stream.mimeType.includes("webm") ? "webm" : "m4a";
      const extraFilename = `${videoId}-audio-extra-${i}.${extraExtension}`;
      ffmpeg.FS.writeFile(extraFilename, extraData);
      extraAudioTracks.push({
        filename: extraFilename,
        label: stream.label
      });
    }

    for (const [i, subtitle] of subtitleStreams.entries()) {
      const subtitleFilename = `${videoId}-subtitle-${i}.srt`;
      ffmpeg.FS.writeFile(subtitleFilename, new TextEncoder().encode(subtitle.srtContent));
      subtitleFiles.push({
        filename: subtitleFilename,
        languageCode: subtitle.languageCode,
        label: subtitle.label
      });
    }

    const ffmpegArgs = buildFfmpegArgs({
      videoFilename,
      primaryAudioFilename,
      extraAudioTracks,
      subtitleFiles,
      outputFilename,
      outputExtension,
      audioMimeType,
      primaryAudioLabel: item.primaryAudioLabel ?? "",
      additionalAudioLabels: extraAudioTracks.map(track => track.label)
    });

    const exitCode = ffmpeg.exec(...ffmpegArgs);
    if (exitCode !== 0) {
      throw new Error(`FFmpeg exited with code ${exitCode}`);
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
    tryUnlink({
      ffmpeg,
      filename: outputFilename
    });
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

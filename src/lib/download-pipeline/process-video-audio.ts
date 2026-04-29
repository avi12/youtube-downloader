import { triggerDownload, reportProgress } from ".";
import { writeExtraAudioFiles, writeSubtitleFiles, writeVideoAudioToFs } from "./ffmpeg-file-setup";
import { getFFmpeg, progressHandlers, tryUnlink } from "./ffmpeg-instance";
import { runFfmpegMux, saveOutput } from "./ffmpeg-mux-runner";
import { buildVideoAudioFilenames } from "./video-audio-filenames";
import { ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

const FFMPEG_PROGRESS_CAP = 0.99;

export async function processVideoAudio(item: ProcessStreamData) {
  const {
    videoId, filenameOutput, videoMimeType, audioMimeType, tabId, additionalAudioStreams, subtitleStreams
  } = item;
  const isExtraTracksPresent = Boolean(additionalAudioStreams.length || subtitleStreams.length);
  const { videoFilename, primaryAudioFilename, outputFilename, downloadFilename, outputExtension } =
    buildVideoAudioFilenames({
      videoId,
      filenameOutput,
      videoMimeType,
      audioMimeType,
      isExtraTracksPresent
    });
  const ffmpeg = getFFmpeg();

  function handleFFmpegProgress({ progress }: { progress: number }) {
    void reportProgress({
      videoId,
      progress: Math.min(progress, FFMPEG_PROGRESS_CAP),
      progressType: ProgressType.FFmpeg,
      tabId
    });
  }

  progressHandlers.add(handleFFmpegProgress);
  const extraAudioTracks = writeExtraAudioFiles({
    videoId,
    additionalAudioStreams
  });
  const subtitleFiles = writeSubtitleFiles({
    videoId,
    subtitleStreams
  });

  try {
    const { videoData, audioData } = writeVideoAudioToFs({
      videoFilename,
      primaryAudioFilename,
      item
    });
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
    const ffmpegOutput = runFfmpegMux({
      videoFilename,
      primaryAudioFilename,
      extraAudioTracks,
      subtitleFiles,
      outputFilename,
      outputExtension,
      audioMimeType,
      item
    });
    await saveOutput({
      item,
      ffmpegOutput,
      downloadFilename,
      filenameOutput,
      tabId,
      videoId
    });
  } finally {
    progressHandlers.delete(handleFFmpegProgress);
    for (const filename of [videoFilename, primaryAudioFilename, outputFilename]) {
      tryUnlink({
        ffmpeg,
        filename
      });
    }

    for (const { filename } of [...extraAudioTracks, ...subtitleFiles]) {
      tryUnlink({
        ffmpeg,
        filename
      });
    }
  }
}

import { triggerDownload, reportProgress } from ".";
import { writeExtraAudioFiles, writeSubtitleFiles, writeVideoAudioToFs } from "./ffmpeg-file-setup";
import { progressHandlers, tryUnlink } from "./ffmpeg-instance";
import { runFfmpegMux, saveOutput } from "./ffmpeg-mux-runner";
import { buildVideoAudioFilenames } from "./video-audio-filenames";
import { ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

const FFMPEG_PROGRESS_CAP = 0.99;

async function handleMissingStream({
  videoData,
  audioData,
  filenameOutput,
  videoId,
  tabId,
  metadata
}: {
  videoData: Uint8Array | null;
  audioData: Uint8Array | null;
  filenameOutput: string;
  videoId: string;
  tabId: number;
  metadata: ProcessStreamData["metadata"];
}) {
  const recentContext = {
    videoId,
    title: metadata?.title ?? filenameOutput,
    channel: metadata?.artist ?? "",
    thumbnailUrl: metadata?.thumbnailUrl
  };
  const data = videoData ?? audioData;
  if (data) {
    await triggerDownload({
      data,
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
}

function cleanupFfmpegFiles({
  videoFilename,
  primaryAudioFilename,
  outputFilename,
  extraAudioTracks,
  subtitleFiles
}: {
  videoFilename: string;
  primaryAudioFilename: string;
  outputFilename: string;
  extraAudioTracks: Array<{ filename: string }>;
  subtitleFiles: Array<{ filename: string }>;
}) {
  for (const filename of [videoFilename, primaryAudioFilename, outputFilename]) {
    tryUnlink(filename);
  }

  for (const { filename } of [...extraAudioTracks, ...subtitleFiles]) {
    tryUnlink(filename);
  }
}

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

  function handleFFmpegProgress({ progress }: { progress: number }) {
    void reportProgress({
      videoId,
      progress: Math.min(progress, FFMPEG_PROGRESS_CAP),
      progressType: ProgressType.FFmpeg,
      tabId
    });
  }

  progressHandlers.add(handleFFmpegProgress);
  const [extraAudioTracks, subtitleFiles] = await Promise.all([
    writeExtraAudioFiles({
      videoId,
      additionalAudioStreams
    }),
    writeSubtitleFiles({
      videoId,
      subtitleStreams
    })
  ]);

  try {
    const { videoData, audioData } = await writeVideoAudioToFs({
      videoFilename,
      primaryAudioFilename,
      item
    });
    if (!videoData?.byteLength || !audioData?.byteLength) {
      await handleMissingStream({
        videoData,
        audioData,
        filenameOutput,
        videoId,
        tabId,
        metadata: item.metadata
      });
      return;
    }

    await reportProgress({
      videoId,
      progress: 0,
      progressType: ProgressType.FFmpeg,
      tabId
    });
    const ffmpegOutput = await runFfmpegMux({
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
    cleanupFfmpegFiles({
      videoFilename,
      primaryAudioFilename,
      outputFilename,
      extraAudioTracks,
      subtitleFiles
    });
  }
}

import { toUint8Array, triggerDownload, reportProgress, toOwnedArrayBuffer } from ".";
import { runMuxVideoAudio } from "./ffmpeg-instance";
import { addToPlaylistBundle } from "./playlist-bundle";
import { ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

export async function processVideoAudio(item: ProcessStreamData, isCancelled: () => boolean) {
  const {
    videoId, filenameOutput, videoMimeType, audioMimeType, tabId,
    additionalAudioStreams, subtitleTracks, primaryAudioLanguageCode, defaultAudioTrackIndex
  } = item;

  const videoData = toUint8Array(item.videoData);
  const audioData = toUint8Array(item.audioData);
  if (!videoData || !audioData) {
    if (!videoData && !audioData) {
      throw new Error("No stream data accumulated");
    }

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

  const isExtraTracksPresent = additionalAudioStreams.length > 0;
  const filenameBase = filenameOutput.replace(/\.[^.]+$/, "");
  const targetExtension = isExtraTracksPresent ? "mkv" : (filenameOutput.split(".").pop() ?? "mkv");
  const downloadFilename = `${filenameBase}.${targetExtension}`;

  const extraAudioTracks = additionalAudioStreams
    .map(stream => {
      const data = toUint8Array(stream.data);
      if (!data) {
        return null;
      }

      return {
        data: toOwnedArrayBuffer(data),
        label: stream.label,
        languageCode: stream.languageCode ?? ""
      };
    })
    .filter((track): track is {
      data: ArrayBuffer;
      label: string;
      languageCode: string;
    } => track !== null);

  const subtitleFiles = subtitleTracks
    .filter(track => track.data !== null)
    .map(track => ({
      data: track.data!,
      label: track.label,
      languageCode: track.languageCode
    }));

  const videoBuffer = toOwnedArrayBuffer(videoData);
  const audioBuffer = toOwnedArrayBuffer(audioData);

  const output = await runMuxVideoAudio(
    videoId,
    {
      videoData: videoBuffer,
      audioData: audioBuffer,
      extraAudioTracks,
      subtitleTracks: subtitleFiles,
      videoMimeType,
      audioMimeType,
      videoId,
      tabId,
      primaryAudioLabel: item.primaryAudioLabel ?? "",
      primaryAudioLanguageCode: primaryAudioLanguageCode ?? "",
      defaultAudioTrackIndex: defaultAudioTrackIndex ?? 0,
      filenameOutput
    }
  );
  if (isCancelled()) {
    return;
  }

  if (item.playlistId) {
    await addToPlaylistBundle({
      playlistId: item.playlistId,
      playlistTitle: item.playlistTitle ?? "Playlist",
      totalCount: item.playlistTotalCount ?? 1,
      tabId,
      filename: downloadFilename,
      data: output
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
    data: output,
    filenameOutput: downloadFilename,
    recentContext: {
      videoId,
      title: item.metadata?.title ?? filenameOutput,
      channel: item.metadata?.artist ?? "",
      thumbnailUrl: item.metadata?.thumbnailUrl,
      audioMimeType
    }
  });
  await reportProgress({
    videoId,
    progress: 1,
    progressType: ProgressType.FFmpeg,
    tabId
  });
}

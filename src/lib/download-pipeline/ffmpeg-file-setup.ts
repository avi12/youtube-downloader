import { toUint8Array } from ".";
import type { AudioTrackFile, SubtitleFile } from "./ffmpeg-args-builder";
import { getFFmpeg } from "./ffmpeg-instance";
import type { ProcessStreamData } from "@/types";

export async function writeVideoAudioToFs({ videoFilename, primaryAudioFilename, item }: {
  videoFilename: string;
  primaryAudioFilename: string;
  item: ProcessStreamData;
}) {
  const ffmpeg = getFFmpeg();
  const videoData = toUint8Array(item.videoData);
  const audioData = toUint8Array(item.audioData);
  await Promise.all([
    videoData && ffmpeg.FS.writeFile(videoFilename, videoData),
    audioData && ffmpeg.FS.writeFile(primaryAudioFilename, audioData)
  ]);
  return {
    videoData,
    audioData
  };
}

export async function writeExtraAudioFiles({ videoId, additionalAudioStreams }: {
  videoId: string;
  additionalAudioStreams: ProcessStreamData["additionalAudioStreams"];
}) {
  const ffmpeg = getFFmpeg();
  const extraAudioTracks: AudioTrackFile[] = [];

  for (const [i, stream] of additionalAudioStreams.entries()) {
    const extraData = toUint8Array(stream.data);
    if (!extraData) {
      continue;
    }

    const extraExtension = stream.mimeType.includes("webm") ? "webm" : "m4a";
    const extraFilename = `${videoId}-audio-extra-${i}.${extraExtension}`;
    await ffmpeg.FS.writeFile(extraFilename, extraData);
    extraAudioTracks.push({
      filename: extraFilename,
      label: stream.label
    });
  }

  return extraAudioTracks;
}

export async function writeSubtitleFiles({ videoId, subtitleStreams }: {
  videoId: string;
  subtitleStreams: ProcessStreamData["subtitleStreams"];
}) {
  const ffmpeg = getFFmpeg();
  const subtitleFiles: SubtitleFile[] = [];

  for (const [i, subtitle] of subtitleStreams.entries()) {
    const subtitleFilename = `${videoId}-subtitle-${i}.srt`;
    await ffmpeg.FS.writeFile(subtitleFilename, new TextEncoder().encode(subtitle.srtContent));
    subtitleFiles.push({
      filename: subtitleFilename,
      languageCode: subtitle.languageCode,
      label: subtitle.label
    });
  }

  return subtitleFiles;
}

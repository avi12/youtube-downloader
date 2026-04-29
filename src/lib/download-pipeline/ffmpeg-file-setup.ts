import { toUint8Array } from ".";
import type { AudioTrackFile, SubtitleFile } from "./ffmpeg-args-builder";
import { getFFmpeg } from "./ffmpeg-instance";
import type { ProcessStreamData } from "@/types";

export function writeVideoAudioToFs({ videoFilename, primaryAudioFilename, item }: {
  videoFilename: string;
  primaryAudioFilename: string;
  item: ProcessStreamData;
}) {
  const ffmpeg = getFFmpeg();
  const videoData = toUint8Array(item.videoData);
  const audioData = toUint8Array(item.audioData);
  if (videoData) {
    ffmpeg.FS.writeFile(videoFilename, videoData);
  }

  if (audioData) {
    ffmpeg.FS.writeFile(primaryAudioFilename, audioData);
  }

  return {
    videoData,
    audioData
  };
}

export function writeExtraAudioFiles({ videoId, additionalAudioStreams }: {
  videoId: string;
  additionalAudioStreams: ProcessStreamData["additionalAudioStreams"];
}): AudioTrackFile[] {
  const ffmpeg = getFFmpeg();
  const extraAudioTracks: AudioTrackFile[] = [];

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

  return extraAudioTracks;
}

export function writeSubtitleFiles({ videoId, subtitleStreams }: {
  videoId: string;
  subtitleStreams: ProcessStreamData["subtitleStreams"];
}): SubtitleFile[] {
  const ffmpeg = getFFmpeg();
  const subtitleFiles: SubtitleFile[] = [];

  for (const [i, subtitle] of subtitleStreams.entries()) {
    const subtitleFilename = `${videoId}-subtitle-${i}.srt`;
    ffmpeg.FS.writeFile(subtitleFilename, new TextEncoder().encode(subtitle.srtContent));
    subtitleFiles.push({
      filename: subtitleFilename,
      languageCode: subtitle.languageCode,
      label: subtitle.label
    });
  }

  return subtitleFiles;
}

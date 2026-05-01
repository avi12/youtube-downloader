import { toUint8Array } from ".";
import { getFFmpeg } from "./ffmpeg-instance";
import type { ProcessStreamData } from "@/types";

type ExtraAudioStream = ProcessStreamData["additionalAudioStreams"][number];
type SubtitleStream = ProcessStreamData["subtitleStreams"][number];

export type ExtraAudioInput = {
  filename: string;
  label: string;
  mimeType: string;
};
export type SubtitleInput = {
  filename: string;
  languageCode: string;
  label: string;
};

export function writeExtraInputs({
  ffmpeg, extraAudioStreams, subtitleStreams, writtenPaths
}: {
  ffmpeg: ReturnType<typeof getFFmpeg>;
  extraAudioStreams: ExtraAudioStream[];
  subtitleStreams: SubtitleStream[];
  writtenPaths: string[];
}) {
  const extraAudioInputs: ExtraAudioInput[] = [];
  const subtitleInputs: SubtitleInput[] = [];

  for (const [iAudio, stream] of extraAudioStreams.entries()) {
    const data = toUint8Array(stream.data);
    if (!data) {
      continue;
    }

    const ext = stream.mimeType.includes("webm") ? "webm" : "m4a";
    const extraName = `tmp_extra_${iAudio}.${ext}`;
    ffmpeg.FS.writeFile(extraName, data);
    writtenPaths.push(extraName);
    extraAudioInputs.push({
      filename: extraName,
      label: stream.label,
      mimeType: stream.mimeType
    });
  }

  for (const [iSubtitle, sub] of subtitleStreams.entries()) {
    const subName = `tmp_sub_${iSubtitle}.srt`;
    ffmpeg.FS.writeFile(subName, new TextEncoder().encode(sub.srtContent));
    writtenPaths.push(subName);
    subtitleInputs.push({
      filename: subName,
      languageCode: sub.languageCode,
      label: sub.label
    });
  }

  return {
    extraAudioInputs,
    subtitleInputs
  };
}

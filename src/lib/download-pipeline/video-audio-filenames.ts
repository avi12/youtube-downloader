import { getCompatibleFilename, getOutputExtension } from "@/lib/utils/containers";

function determineOutputExtension({ videoMimeType, audioMimeType, isExtraTracksPresent, filenameOutput }: {
  videoMimeType: string;
  audioMimeType: string;
  isExtraTracksPresent: boolean;
  filenameOutput: string;
}) {
  if (isExtraTracksPresent) {
    return "mkv";
  }

  const userExtension = filenameOutput.split(".").pop() ?? "mp4";
  return getOutputExtension({
    videoMimeType,
    audioMimeType,
    userExtension
  });
}

export function buildVideoAudioFilenames({
  videoId, filenameOutput, videoMimeType, audioMimeType, isExtraTracksPresent
}: {
  videoId: string;
  filenameOutput: string;
  videoMimeType: string;
  audioMimeType: string;
  isExtraTracksPresent: boolean;
}) {
  const videoExtension = videoMimeType.includes("webm") ? "webm" : "mp4";
  const audioExtension = audioMimeType.includes("webm") ? "webm" : "m4a";
  const outputExtension = determineOutputExtension({
    videoMimeType,
    audioMimeType,
    isExtraTracksPresent,
    filenameOutput
  });
  const filenameBase = filenameOutput.replace(/\.[^.]+$/, "");
  const downloadFilename = `${filenameBase}.${outputExtension}`;

  return {
    videoFilename: `${videoId}-video.${videoExtension}`,
    primaryAudioFilename: `${videoId}-audio.${audioExtension}`,
    outputFilename: getCompatibleFilename(`${videoId}-${downloadFilename}`),
    downloadFilename,
    outputExtension
  };
}

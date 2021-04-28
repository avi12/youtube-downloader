import { createFFmpeg } from "@ffmpeg/ffmpeg";
import type { AdaptiveFormatItem, VideoData } from "./types";
import { parseText } from "./yt-downloader-utils";
import { getVideoMetadata } from "./yt-downloader-functions";
import { downloadTrack } from "./download-options/audio-simple";
import { saveAs } from "file-saver";
import { getVideoAudio } from "./download-options/video-simple";

export const ffmpeg = createFFmpeg({ log: true });

chrome.runtime.onConnect.addListener(port => {
  switch (port.name) {
    case "download-video-simple":
      port.onMessage.addListener(params => {
        downloadItem(port, params);
        // TODO: Handle canceling
      });
      break;

    case "get-video-info":
      port.onMessage.addListener(async id => {
        const url = `https://www.youtube.com/get_video_info?video_id=${id}`;
        const response = await fetch(url);
        port.postMessage(parseText(await response.text()));
      });
      break;
  }
});

async function downloadItem(
  port: chrome.runtime.Port,
  {
    id,
    qualityChosen
  }: {
    id: string;
    qualityChosen: number;
    videoData: VideoData;
  }
) {
  if (!ffmpeg.isLoaded()) {
    await ffmpeg.load();
  }
  ffmpeg.setProgress(({ ratio }) => port.postMessage(ratio * 100));
  const playerResponse = await getVideoMetadata({ id });

  const {
    streamingData: { adaptiveFormats },
    videoDetails: { title },
    microformat: {
      playerMicroformatRenderer: { category }
    }
  } = playerResponse;

  const audio = getMediaUrl({
    mediaType: "audio",
    adaptiveFormats,
    quality: qualityChosen
  }) as AdaptiveFormatItem;
  if (category === "Music") {
    await downloadTrack({ id, playerResponse, audio, title });
    return;
  }

  const { blobDownload, filenameOutput } = await getVideoAudio({
    playerResponse,
    audio,
    id,
    qualityChosen
  });
  saveAs(blobDownload, filenameOutput);
}

export function deleteFiles(files: string[]) {
  for (const file of files) {
    ffmpeg.FS("unlink", file);
  }
}

export async function getRemote(
  url: string,
  isGetText?: boolean
): Promise<any> {
  const response = await fetch(url);
  const text = await response.text();
  if (isGetText) {
    return text;
  }
  return parseText(text);
}

export function getMediaUrl({
  mediaType,
  adaptiveFormats,
  quality
}: {
  mediaType: "audio" | "video";
  adaptiveFormats: AdaptiveFormatItem[];
  quality?: number;
}): string | AdaptiveFormatItem {
  if (mediaType === "video") {
    const { url } = adaptiveFormats.find(
      format =>
        format.mimeType.startsWith(mediaType) &&
        parseInt(format.qualityLabel) === quality
    );
    return url;
  }

  const audios = adaptiveFormats.filter(format =>
    format.mimeType.startsWith(mediaType)
  );
  const audiosSorted = audios.sort((a, b) => b.bitrate - a.bitrate);
  return audiosSorted[0];
}

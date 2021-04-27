import { createFFmpeg, fetchFile } from "@ffmpeg/ffmpeg";
import type { AdaptiveFormatItem } from "./types";
import { parseText } from "./yt-downloader-utils";
import { getVideoMetadata } from "./yt-downloader-functions";

const ffmpeg = createFFmpeg({ log: true });

chrome.runtime.onConnect.addListener(port => {
  switch (port.name) {
    case "download-video-simple":
      port.onMessage.addListener(params => {
        downloadVideo(params, port);
        // TODO: Handle canceling
      });
      break;

    case "retrieve-script":
      port.onMessage.addListener(async scriptName => {
        const response = await fetch(`build/scripts/${scriptName}.js`);
        const scriptContent = await response.text();
        port.postMessage(scriptContent);
      });
      break;
  }
});

async function downloadVideo(
  {
    adaptiveFormats,
    id,
    quality,
    titleCurrent,
    ytcfg
  }: {
    id: string;
    adaptiveFormats: AdaptiveFormatItem[];
    titleCurrent: string;
    quality: number;
    ytcfg?: {
      STS: number;
      PLAYER_JS_URL: string;
    };
  },
  port: chrome.runtime.Port
) {
  ffmpeg.setProgress(({ ratio }) => port.postMessage(ratio * 100));
  const { formats, title } = await getVideoMetadata({
    id,
    ytcfg,
    titleCurrent,
    adaptiveFormats
  });

  if (!ffmpeg.isLoaded()) {
    await ffmpeg.load();
  }

  const filenameVideo = `${id}.mp4`;
  const filenameAudio = `${id}.mp3`;
  const urlVideo = getMediaUrl({
    mediaType: "video",
    adaptiveFormats: formats,
    quality
  });

  const urlAudio = getMediaUrl({
    mediaType: "audio",
    adaptiveFormats: formats
  });

  ffmpeg.FS("writeFile", filenameVideo, await fetchFile(urlVideo));
  ffmpeg.FS("writeFile", filenameAudio, await fetchFile(urlAudio));
  const filenameOutput = `${title}.mp4`;
  await ffmpeg.run(
    "-i",
    filenameVideo,
    "-i",
    filenameAudio,
    "-c:v",
    "copy",
    filenameOutput
  );

  const dataFile = ffmpeg.FS("readFile", filenameOutput);
  chrome.downloads.download({
    url: URL.createObjectURL(
      new Blob([dataFile.buffer], { type: "video/mp4" })
    ),
    filename: filenameOutput
  });
  deleteFiles([filenameVideo, filenameAudio, filenameOutput]);
}

function deleteFiles(files: string[]) {
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

function getMediaUrl({
  mediaType,
  adaptiveFormats,
  quality
}: {
  mediaType: string;
  adaptiveFormats: AdaptiveFormatItem[];
  quality?: number;
}) {
  if (mediaType === "video") {
    const { url } = adaptiveFormats.find(
      format =>
        format.mimeType.startsWith("video") &&
        parseInt(format.qualityLabel) === quality
    );
    return url;
  }

  const audios = adaptiveFormats.filter(format =>
    format.mimeType.startsWith("audio")
  );
  const audiosSorted = audios.sort((a, b) => b.bitrate - a.bitrate);
  return audiosSorted[0].url;
}

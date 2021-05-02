import { createFFmpeg } from "@ffmpeg/ffmpeg";
import type { AdaptiveFormatItem } from "./types";
import { getStorage, parseText, setStorage } from "./yt-downloader-utils";
import { getVideoMetadata } from "./yt-downloader-functions";
import { downloadTrack } from "./download-options/audio-simple";
import { saveAs } from "file-saver";
import { getVideoAudio } from "./download-options/video-simple";

export const ffmpeg = createFFmpeg({ log: true });

async function init() {
  await setStorage("local", "isFFmpegReady", false);
  if (!ffmpeg.isLoaded()) {
    await ffmpeg.load();
    chrome.storage.local.set({ isFFmpegReady: true });
    console.log("FFmpeg is ready");
  }
}

init();

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
        port.postMessage(await getVideoMetadata({ id }));
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
  }
) {
  if (!(await getStorage("local", "isFFmpegReady"))) {
    chrome.storage.onChanged.addListener(changes => {
      if (changes?.isFFmpegReady.newValue) {
        // @ts-ignore
        downloadItem(...arguments);
      }
    });
    return;
  }

  ffmpeg.setProgress(({ ratio }) => port.postMessage(Math.round(ratio * 100)));
  const { player_response: playerResponse } = await getVideoMetadata({ id });

  const {
    streamingData: { adaptiveFormats },
    videoDetails: { title },
    microformat: {
      playerMicroformatRenderer: { category }
    }
  } = playerResponse;

  const audio = getMediaUrl({
    mediaType: "audio",
    adaptiveFormats
  }) as AdaptiveFormatItem;
  if (category === "Music") {
    await downloadTrack({ id, playerResponse, audio, title });
    return;
  }

  const promise = new CancellablePromise();

  const promiseAudioVideo = promise.wrap(
    getVideoAudio({
      playerResponse,
      audio,
      id,
      qualityChosen
    })
  );

  port.onDisconnect.addListener(() => {
    promise.abort();
  });

  const { blobDownload, filenameOutput } = await promiseAudioVideo;
  console.log("%cAfter await promiseAudioVideo", "color: red");
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

class CancellablePromise {
  private readonly symbolAbort = Symbol("cancelled");
  private readonly promiseAbort: Promise<any>;
  private resolve!: Function; // Works due to promise init

  constructor() {
    this.promiseAbort = new Promise(resolve => (this.resolve = resolve));
  }

  public async wrap<T>(promise: PromiseLike<T>): Promise<T> {
    const result = await Promise.race([promise, this.promiseAbort]);
    if (result === this.symbolAbort) {
      throw new Error("Aborting FFmpeg");
    }

    return result;
  }

  public abort() {
    this.resolve(this.symbolAbort);
  }
}

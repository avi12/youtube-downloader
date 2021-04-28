import type { AdaptiveFormatItem, PlayerResponse } from "../types";
import { fetchFile } from "@ffmpeg/ffmpeg";
import { arrayBufferToBlob } from "blob-util";
import { deleteFiles, ffmpeg, getMediaUrl } from "../background";

export async function getVideoAudio({
  playerResponse,
  audio,
  id,
  qualityChosen
}: {
  playerResponse: PlayerResponse;
  audio: AdaptiveFormatItem;
  id: string;
  qualityChosen: number;
}) {
  const {
    streamingData: { adaptiveFormats },
    videoDetails: { title }
  } = playerResponse;

  const filename = {
    video: `${id}.mp4`,
    audio: `${id}.wav`
  }

  const urlVideo = getMediaUrl({
    mediaType: "video",
    adaptiveFormats,
    quality: qualityChosen
  });

  ffmpeg.FS("writeFile", filename.video, await fetchFile(urlVideo));
  ffmpeg.FS("writeFile", filename.audio, await fetchFile(audio.url));
  const filenameOutput = `${title}.mp4`;
  await ffmpeg.run(
    "-i",
    filename.video,
    "-i",
    filename.audio,
    "-c:v",
    "copy",
    filenameOutput
  );

  const dataFile = ffmpeg.FS("readFile", filenameOutput);
  const blobDownload = arrayBufferToBlob(dataFile.buffer);

  deleteFiles([filename.audio, filename.video, filenameOutput]);
  return { blobDownload, filenameOutput };
}

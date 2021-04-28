import getArtistTItle from "get-artist-title";
import BrowserID3Writer from "browser-id3-writer";
import type { AdaptiveFormatItem, PlayerResponse } from "../types";
import { deleteFiles, ffmpeg } from "../background";
import { fetchFile } from "@ffmpeg/ffmpeg";
import { saveAs } from "file-saver";

function extractExt({ audio }: { audio: AdaptiveFormatItem }) {
  const mime = audio.mimeType.split(";")[0];
  return mime.split("/").pop();
}

export async function downloadTrack({
  playerResponse,
  audio,
  id,
  title
}: {
  playerResponse: PlayerResponse;
  audio: AdaptiveFormatItem;
  id: string;
  title: string;
}) {
  const filename = {
    audio: `${id}.${extractExt({ audio })}`,
    output: `${title}.mp3`
  };
  ffmpeg.FS("writeFile", filename.audio, await fetchFile(audio.url));
  await ffmpeg.run("-i", filename.audio, filename.output);
  const dataFile = ffmpeg.FS("readFile", filename.output);

  const writer = await getMusicTrack({
    playerResponse,
    audio,
    arrayBuffer: dataFile.buffer
  });

  saveAs(writer.getURL(), filename.output);
  writer.revokeURL();
  deleteFiles([filename.audio]);
}

async function getMusicTrack({
  playerResponse,
  audio,
  arrayBuffer
}: {
  playerResponse: PlayerResponse;
  audio: AdaptiveFormatItem;
  arrayBuffer: ArrayBuffer;
}) {
  const {
    videoDetails: { title, videoId },
    microformat: {
      playerMicroformatRenderer: { ownerChannelName }
    }
  } = playerResponse;
  const [artists, titleTrack] = getArtistTItle(title, {
    defaultArtist: ownerChannelName
  });

  const frames = {
    TPE1: artists.split(/, /),
    TIT2: titleTrack,
    WOAF: `https://www.youtube.com/watch?v=${videoId}`,
    TLEN: Number(audio.approxDurationMs),
    APIC: {
      type: 4,
      data: await getThumbnail(videoId),
      description: ""
    }
  };

  return getID3Writer({
    frames,
    arrayBuffer
  });
}

function getID3Writer({
  frames,
  arrayBuffer
}: {
  frames: object;
  arrayBuffer: ArrayBuffer;
}) {
  const writer = new BrowserID3Writer(arrayBuffer);
  for (const frame in frames) {
    if (frames.hasOwnProperty(frame)) {
      writer.setFrame(frame, frames[frame]);
    }
  }
  writer.addTag();
  return writer;
}

async function getThumbnail(id: string): Promise<ArrayBuffer> {
  const base64ToArrayBuffer = (base64: string): ArrayBuffer =>
    Uint8Array.from(atob(base64.split(",")[1]), c => c.charCodeAt(0));

  const url = `https://i.ytimg.com/vi_webp/${id}/maxresdefault.webp`;
  const image = new Image();
  image.src = url;
  const elCanvas = document.createElement("canvas");
  elCanvas.width = 1280;
  elCanvas.height = 720;
  const ctx = elCanvas.getContext("2d");
  return new Promise(resolve => {
    image.addEventListener("load", () => {
      ctx.drawImage(image, 0, 0);
      const dataURL = elCanvas.toDataURL("image/png");
      resolve(base64ToArrayBuffer(dataURL));
    });
  });
}

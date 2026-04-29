import type { FormatProgress } from "./types";
import { ClientAbrState, StreamerContext, VideoPlaybackAbrRequest } from "googlevideo/protos";

export function buildRequestBody({ templateBody, playerTimeMs, audio, video, playbackCookieBytes }: {
  templateBody: Uint8Array;
  playerTimeMs: number;
  audio: FormatProgress;
  video: FormatProgress;
  playbackCookieBytes: Uint8Array | null;
}): Uint8Array {
  const decoded = VideoPlaybackAbrRequest.decode(templateBody);
  decoded.playerTimeMs = String(playerTimeMs);

  if (!decoded.clientAbrState) {
    decoded.clientAbrState = ClientAbrState.decode(new Uint8Array());
  }

  decoded.clientAbrState.playerTimeMs = String(playerTimeMs);
  decoded.bufferedRanges = [];

  for (const formatId of decoded.selectedFormatIds) {
    let target: FormatProgress | null = null;
    if (formatId.itag === audio.itag) {
      target = audio;
    } else if (formatId.itag === video.itag) {
      target = video;
    }

    if (target && target.endMs > 0) {
      decoded.bufferedRanges.push({
        formatId,
        startTimeMs: "0",
        durationMs: String(target.endMs),
        startSegmentIndex: 1,
        endSegmentIndex: target.lastSeq
      });
    }
  }

  if (playbackCookieBytes) {
    if (!decoded.streamerContext) {
      decoded.streamerContext = StreamerContext.decode(new Uint8Array());
    }

    decoded.streamerContext.playbackCookie = playbackCookieBytes;
  }

  return VideoPlaybackAbrRequest.encode(decoded).finish();
}

export async function performFetch({ url, body, originalFetch }: {
  url: string;
  body: Uint8Array;
  originalFetch: typeof globalThis.fetch;
}): Promise<Uint8Array> {
  const fresh = new Uint8Array(body.byteLength);
  fresh.set(body);
  const response = await originalFetch(url, {
    method: "POST",
    body: fresh,
    mode: "cors",
    credentials: "include"
  });
  if (!response.ok) {
    throw new Error(`SABR fetch returned status ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

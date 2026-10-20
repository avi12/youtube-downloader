import type { StreamFormat } from "@/lib/schemas";
import { VideoPlaybackAbrRequest } from "googlevideo/protos";
import { SabrStream } from "googlevideo/sabr-stream";
import { EnabledTrackTypes, buildSabrFormat } from "googlevideo/utils";

const MIN_ATTESTED_PO_TOKEN_BYTES = 32;
const REQUEST_NUMBER_PARAM = "rn";
const MAX_SABR_RETRIES = 2;
const AUDIO_MIME_PREFIX = "audio/";

export type SabrSession = {
  url: string;
  ustreamerConfig: string;
  poToken: string;
  clientName: number;
  clientVersion: string;
  durationMs: number;
  formats: StreamFormat[];
};

type CapturedRequest = {
  url: string;
  body: string;
};
type SessionSource = {
  requests: CapturedRequest[];
  formats: StreamFormat[];
};

function fromBase64(text: string) {
  return Uint8Array.from(atob(text), character => character.charCodeAt(0));
}

function toBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

export function buildSabrSession({ requests, formats }: SessionSource): SabrSession {
  const attested = requests
    .map(({ url, body }) => ({
      url,
      request: VideoPlaybackAbrRequest.decode(fromBase64(body))
    }))
    .filter(({ request }) => {
      const tokenBytes = request.streamerContext?.poToken?.byteLength ?? 0;
      return tokenBytes >= MIN_ATTESTED_PO_TOKEN_BYTES && request.videoPlaybackUstreamerConfig?.byteLength;
    })
    .at(-1);
  const { poToken, clientInfo } = attested?.request.streamerContext ?? {};
  const ustreamerConfig = attested?.request.videoPlaybackUstreamerConfig;
  if (!attested || !poToken || !ustreamerConfig) {
    throw new Error("The video player hasn't started streaming yet, play the video for a moment and try again");
  }

  const url = new URL(attested.url);
  url.searchParams.delete(REQUEST_NUMBER_PARAM);
  return {
    url: url.href,
    ustreamerConfig: toBase64(ustreamerConfig),
    poToken: toBase64(poToken),
    clientName: clientInfo?.clientName ?? 0,
    clientVersion: clientInfo?.clientVersion ?? "",
    durationMs: Number(formats.find(format => format.approxDurationMs)?.approxDurationMs) || 0,
    formats
  };
}

function toSabrFormat(format: StreamFormat) {
  return buildSabrFormat({
    itag: format.itag,
    lastModified: format.lastModified,
    xtags: format.xtags,
    width: format.width,
    height: format.height,
    mimeType: format.mimeType,
    audioQuality: format.audioQuality,
    bitrate: format.bitrate,
    averageBitrate: format.averageBitrate,
    quality: format.quality,
    qualityLabel: format.qualityLabel,
    audioTrackId: format.audioTrack?.id,
    approxDurationMs: format.approxDurationMs,
    contentLength: format.contentLength,
    isDrc: false
  });
}

type DownloadParams = {
  session: SabrSession;
  format: StreamFormat;
  signal: AbortSignal;
  onProgress: (ratio: number) => void;
};

export async function downloadSabrTrack({ session, format, signal, onProgress }: DownloadParams) {
  const stream = new SabrStream({
    fetch: (input, init) => fetch(input, {
      ...init,
      signal
    }),
    serverAbrStreamingUrl: session.url,
    videoPlaybackUstreamerConfig: session.ustreamerConfig,
    poToken: session.poToken,
    clientInfo: {
      clientName: session.clientName,
      clientVersion: session.clientVersion
    },
    formats: session.formats.map(toSabrFormat),
    durationMs: session.durationMs
  });
  const isAudio = format.mimeType.startsWith(AUDIO_MIME_PREFIX);
  const sabrFormat = toSabrFormat(format);
  const started = await stream.start(
    isAudio
      ? {
        audioFormat: sabrFormat,
        enabledTrackTypes: EnabledTrackTypes.AUDIO_ONLY,
        maxRetries: MAX_SABR_RETRIES
      }
      : {
        videoFormat: sabrFormat,
        enabledTrackTypes: EnabledTrackTypes.VIDEO_ONLY,
        maxRetries: MAX_SABR_RETRIES
      }
  );
  const reader = (isAudio ? started.audioStream : started.videoStream).getReader();
  const expectedBytes = Number(format.contentLength) || 0;
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  signal.addEventListener("abort", () => reader.cancel().catch(() => undefined), { once: true });
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    chunks.push(chunk.value);
    receivedBytes += chunk.value.byteLength;
    onProgress(expectedBytes ? Math.min(receivedBytes / expectedBytes, 1) : 0);
  }

  signal.throwIfAborted();

  if (expectedBytes && receivedBytes < expectedBytes) {
    throw new Error(`YouTube cut the stream short (${receivedBytes} of ${expectedBytes} bytes), try again`);
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

import { type AdaptiveFormatItem, type SabrConfig } from "@/types";
import { SabrStream, type SabrStreamState } from "googlevideo/sabr-stream";
import { buildSabrFormat } from "googlevideo/utils";

function adaptiveFormatToSabrFormat(format: AdaptiveFormatItem) {
  return buildSabrFormat({
    itag: format.itag,
    lastModified: String(format.lastModified),
    xtags: format.xtags,
    width: format.width,
    height: format.height,
    mimeType: format.mimeType,
    audioQuality: format.audioQuality,
    bitrate: format.bitrate,
    averageBitrate: format.averageBitrate,
    quality: format.quality,
    qualityLabel: format.qualityLabel ?? undefined,
    audioTrackId: format.audioTrack?.id,
    approxDurationMs: format.approxDurationMs,
    contentLength: format.contentLength,
    isDrc: false
  });
}

function createSabrStream({ sabrConfig, fetchFn, poToken }: {
  sabrConfig: SabrConfig;
  fetchFn: typeof globalThis.fetch;
  poToken: string;
}) {
  const sabrFormats = sabrConfig.formats.map(adaptiveFormatToSabrFormat);
  const durationMs = parseInt(sabrConfig.formats[0]?.approxDurationMs ?? "0", 10);

  return new SabrStream({
    fetch: fetchFn,
    serverAbrStreamingUrl: sabrConfig.serverAbrStreamingUrl,
    videoPlaybackUstreamerConfig: sabrConfig.videoPlaybackUstreamerConfig,
    poToken: poToken || undefined,
    clientInfo: {
      clientName: sabrConfig.clientName,
      clientVersion: sabrConfig.clientVersion
    },
    formats: sabrFormats,
    durationMs
  });
}

export type SabrSessionCredentials = {
  sabrUrl?: string;
  poToken?: string;
};

export type RotateSabrSession = (args: { stalePoToken: string }) => Promise<SabrSessionCredentials | null>;

const MAX_SESSION_ROTATIONS = 8;

async function streamWithRotation({ initialSabrConfig, poToken, fetchFn, startSession, rotateSession }: {
  initialSabrConfig: SabrConfig;
  poToken: string;
  fetchFn: typeof globalThis.fetch;
  startSession: (sabrStream: SabrStream, state?: SabrStreamState) => Promise<void>;
  rotateSession?: RotateSabrSession;
}) {
  let currentConfig = initialSabrConfig;
  let currentPoToken = poToken;
  let resumeState: SabrStreamState | undefined;

  for (let attempt = 0; attempt <= MAX_SESSION_ROTATIONS; attempt++) {
    const sabrStream = createSabrStream({
      sabrConfig: currentConfig,
      fetchFn,
      poToken: currentPoToken
    });

    try {
      await startSession(sabrStream, resumeState);
      return;
    } catch (error) {
      if (!rotateSession || attempt === MAX_SESSION_ROTATIONS) {
        throw error;
      }

      try {
        resumeState = sabrStream.getState();
      } catch {
        resumeState = undefined;
      }

      const fresh = await rotateSession({ stalePoToken: currentPoToken });
      if (!fresh?.poToken) {
        throw error;
      }

      currentPoToken = fresh.poToken;
      if (fresh.sabrUrl) {
        currentConfig = { ...currentConfig, serverAbrStreamingUrl: fresh.sabrUrl };
      }
    }
  }
}

export async function fetchVideoAudioViaSabrStream({ sabrConfig, videoFormat, audioFormat, fetchFn, poToken, rotateSession }: {
  sabrConfig: SabrConfig;
  videoFormat: AdaptiveFormatItem;
  audioFormat: AdaptiveFormatItem;
  fetchFn: typeof globalThis.fetch;
  poToken: string;
  rotateSession?: RotateSabrSession;
}) {
  const videoChunks: Uint8Array[] = [];
  const audioChunks: Uint8Array[] = [];

  await streamWithRotation({
    initialSabrConfig: sabrConfig,
    poToken,
    fetchFn,
    rotateSession,
    async startSession(sabrStream, state) {
      const { videoStream, audioStream } = await sabrStream.start({
        videoFormat: adaptiveFormatToSabrFormat(videoFormat),
        audioFormat: adaptiveFormatToSabrFormat(audioFormat),
        maxRetries: 3,
        state
      });
      await Promise.all([
        drainInto(videoStream, videoChunks),
        drainInto(audioStream, audioChunks)
      ]);
    }
  });

  return {
    videoData: concatChunks(videoChunks),
    audioData: concatChunks(audioChunks)
  };
}

export async function fetchAudioViaSabrStream({ sabrConfig, audioFormat, fetchFn, poToken, rotateSession }: {
  sabrConfig: SabrConfig;
  audioFormat: AdaptiveFormatItem;
  fetchFn: typeof globalThis.fetch;
  poToken: string;
  rotateSession?: RotateSabrSession;
}) {
  const audioChunks: Uint8Array[] = [];

  await streamWithRotation({
    initialSabrConfig: sabrConfig,
    poToken,
    fetchFn,
    rotateSession,
    async startSession(sabrStream, state) {
      const { audioStream } = await sabrStream.start({
        audioFormat: adaptiveFormatToSabrFormat(audioFormat),
        maxRetries: 3,
        state
      });
      await drainInto(audioStream, audioChunks);
    }
  });

  return concatChunks(audioChunks);
}

async function drainInto(stream: ReadableStream<Uint8Array>, chunks: Uint8Array[]) {
  const reader = stream.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      return;
    }

    if (value) {
      chunks.push(value);
    }
  }
}

function concatChunks(chunks: Uint8Array[]) {
  const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return combined;
}

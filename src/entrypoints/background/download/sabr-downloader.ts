import type { DownloadResult } from "./background-downloader";
import { createProgressFetch } from "./progress-fetch";
import { sendProgressUpdate } from "./progress-fetch";
import {
  fetchAudioViaSabrStream,
  fetchVideoAudioViaSabrStreamBootstrapped,
  fetchVideoViaSabrStream
} from "@/lib/youtube/sabr-download";
import { DownloadType, ProgressType } from "@/types";
import type { AdaptiveFormatItem, DownloadRequest, SabrConfig } from "@/types";

const latestPoTokenByVideoId = new Map<string, string>();

export function registerPoTokenRefreshListener() {
  onMessage(MessageType.PoTokenRefreshed, ({ data }) => {
    latestPoTokenByVideoId.set(data.videoId, data.poToken);
  });
}

function takeRefreshedPoToken(videoId: string, lastUsed: string) {
  const latest = latestPoTokenByVideoId.get(videoId);
  if (!latest || latest === lastUsed) {
    return null;
  }

  return latest;
}

export function buildEffectiveSabrConfig({ sabrConfig, sabrUrl }: {
  sabrConfig: SabrConfig;
  sabrUrl: string | undefined;
}): SabrConfig {
  if (sabrUrl && sabrUrl !== sabrConfig.serverAbrStreamingUrl) {
    return {
      ...sabrConfig,
      serverAbrStreamingUrl: sabrUrl
    };
  }

  return sabrConfig;
}

export function parseContentLength(format: AdaptiveFormatItem | null) {
  if (!format?.contentLength) {
    return 0;
  }

  return parseInt(format.contentLength, 10);
}

async function downloadAudioOnlyViaSabr({ config, audioFormat, poToken, signal, videoId, tabId, onProgress }: {
  config: SabrConfig;
  audioFormat: AdaptiveFormatItem;
  poToken: string;
  signal: AbortSignal;
  videoId: string;
  tabId: number;
  onProgress?: () => void;
}) {
  const audioExpectedBytes = parseContentLength(audioFormat);
  let audioReceivedBytes = 0;

  const sabrFetch = createProgressFetch({
    signal,
    onBytesReceived(bytes) {
      audioReceivedBytes += bytes;
      onProgress?.();
      const totalBytes = audioExpectedBytes || audioReceivedBytes;
      void sendProgressUpdate({
        videoId,
        progress: Math.min(audioReceivedBytes / totalBytes, 1),
        progressType: ProgressType.Video,
        tabId
      });
    }
  });

  let lastAppliedToken = poToken;
  return fetchAudioViaSabrStream({
    sabrConfig: config,
    audioFormat,
    fetchFn: sabrFetch,
    poToken,
    async refreshToken() {
      const next = takeRefreshedPoToken(videoId, lastAppliedToken);
      if (next) {
        lastAppliedToken = next;
      }

      return next;
    }
  });
}

async function downloadVideoAudioViaSabr({
  config, videoFormat, audioFormat, poToken, signal, videoId, tabId, onProgress
}: {
  config: SabrConfig;
  videoFormat: AdaptiveFormatItem;
  audioFormat: AdaptiveFormatItem;
  poToken: string;
  signal: AbortSignal;
  videoId: string;
  tabId: number;
  onProgress?: () => void;
}) {
  const videoExpectedBytes = parseContentLength(videoFormat);
  const audioExpectedBytes = parseContentLength(audioFormat);
  const totalExpectedBytes = videoExpectedBytes + audioExpectedBytes;
  let totalReceivedBytes = 0;

  function makeProgressFetch() {
    return createProgressFetch({
      signal,
      onBytesReceived(bytes) {
        totalReceivedBytes += bytes;
        onProgress?.();

        if (totalExpectedBytes > 0) {
          void sendProgressUpdate({
            videoId,
            progress: Math.min(totalReceivedBytes / totalExpectedBytes, 1),
            progressType: ProgressType.Video,
            tabId
          });
        }
      }
    });
  }

  return Promise.all([
    fetchVideoViaSabrStream({
      sabrConfig: config,
      videoFormat,
      fetchFn: makeProgressFetch(),
      poToken
    }),
    fetchAudioViaSabrStream({
      sabrConfig: config,
      audioFormat,
      fetchFn: makeProgressFetch(),
      poToken
    })
  ]);
}

async function downloadExtraAudioTracksViaSabr({ config, formats, poToken, signal, onProgress }: {
  config: SabrConfig;
  formats: AdaptiveFormatItem[];
  poToken: string;
  signal: AbortSignal;
  onProgress?: () => void;
}) {
  const tracks: DownloadResult["additionalAudioTracks"] = [];

  for (const format of formats) {
    try {
      const sabrFetch = createProgressFetch({
        signal,
        onBytesReceived() {
          onProgress?.();
        }
      });
      const data = await fetchAudioViaSabrStream({
        sabrConfig: config,
        audioFormat: format,
        fetchFn: sabrFetch,
        poToken
      });
      tracks.push({
        data,
        mimeType: format.mimeType.split(";")[0] ?? "audio/mp4",
        label: format.audioTrack?.displayName ?? ""
      });
    } catch (trackError) {
      console.warn("[ytdl:bg] Extra audio track failed:", format.audioTrack?.displayName, trackError);
    }
  }

  return tracks;
}

export async function downloadViaSabrWithTrustTemplate({
  request, signal, tabId, onProgress, templateUrl, templateBody, onCallLog
}: {
  request: DownloadRequest;
  signal: AbortSignal;
  tabId: number;
  onProgress?: () => void;
  templateUrl: string;
  templateBody: Uint8Array;
  onCallLog?: (msg: string) => void;
}): Promise<DownloadResult | null> {
  const { videoId, sabrConfig, poToken, sabrUrl, videoFormat, audioFormat } = request;
  if (!sabrConfig || !videoFormat || !audioFormat) {
    return null;
  }

  const effectiveConfig = buildEffectiveSabrConfig({
    sabrConfig,
    sabrUrl
  });
  const videoExpectedBytes = parseContentLength(videoFormat);
  const audioExpectedBytes = parseContentLength(audioFormat);
  const totalExpectedBytes = videoExpectedBytes + audioExpectedBytes;
  let totalReceivedBytes = 0;

  const sabrFetch = createProgressFetch({
    signal,
    onBytesReceived(bytes) {
      totalReceivedBytes += bytes;
      onProgress?.();

      if (totalExpectedBytes > 0) {
        void sendProgressUpdate({
          videoId,
          progress: Math.min(totalReceivedBytes / totalExpectedBytes, 1),
          progressType: ProgressType.Video,
          tabId
        });
      }
    }
  });

  // Hard outer timeout: SabrStream sometimes hangs after the server's per-
  // session media quota kicks in (~80s of media for long Firefox videos) and
  // its internal stall detection doesn't fire because control-only responses
  // keep resetting all the stall timers.
  const HARD_BOOTSTRAP_TIMEOUT_MS = 120_000;
  const bootstrapPromise = fetchVideoAudioViaSabrStreamBootstrapped({
    sabrConfig: effectiveConfig,
    videoFormat,
    audioFormat,
    fetchFn: sabrFetch,
    poToken: poToken ?? "",
    templateUrl,
    templateBody,
    onCallLog
  });
  const timeoutPromise = new Promise<{
    videoBytes: Uint8Array;
    audioBytes: Uint8Array;
  }>((_, reject) => {
    setTimeout(
      () => reject(new Error(`bootstrap hard-timeout after ${HARD_BOOTSTRAP_TIMEOUT_MS}ms`)),
      HARD_BOOTSTRAP_TIMEOUT_MS
    );
  });
  let videoBytes: Uint8Array;
  let audioBytes: Uint8Array;
  try {
    ({ videoBytes, audioBytes } = await Promise.race([bootstrapPromise, timeoutPromise]));
  } catch (error) {
    onCallLog?.(`bootstrap timed out: ${String(error)}`);
    return null;
  }

  onCallLog?.(
    `bootstrap done: video=${videoBytes.byteLength}/${videoExpectedBytes}B `
    + `audio=${audioBytes.byteLength}/${audioExpectedBytes}B`
  );

  // Accept whatever the lib delivered — even if partial. Server's per-session
  // media quota caps any single SabrStream iteration at ~80-100s of media for
  // long Firefox videos; rejecting incomplete bytes only triggers iframe-scrub
  // (which has its own autoplay flakiness). Better to ship a partial file
  // (user gets the first ~80s of their video) than nothing.
  if (audioBytes.byteLength === 0 && videoBytes.byteLength === 0) {
    onCallLog?.("bootstrap returned 0 bytes; falling through");
    return null;
  }

  return {
    videoData: videoBytes,
    audioData: audioBytes,
    additionalAudioTracks: []
  };
}

export async function downloadViaSabr({ request, signal, tabId, onProgress }: {
  request: DownloadRequest;
  signal: AbortSignal;
  tabId: number;
  onProgress?: () => void;
}): Promise<DownloadResult | null> {
  const { videoId, type, sabrConfig, poToken, sabrUrl, videoFormat, audioFormat, additionalAudioFormats } = request;
  const isAudioOnly = type === DownloadType.Audio;

  const effectiveConfig = sabrConfig ? buildEffectiveSabrConfig({
    sabrConfig,
    sabrUrl
  }) : null;
  if (!effectiveConfig || !audioFormat) {
    return null;
  }

  if (!isAudioOnly && !videoFormat) {
    return null;
  }

  const resolvedPoToken = poToken ?? "";
  if (isAudioOnly) {
    const audioData = await downloadAudioOnlyViaSabr({
      config: effectiveConfig,
      audioFormat,
      poToken: resolvedPoToken,
      signal,
      videoId,
      tabId,
      onProgress
    });
    return {
      videoData: null,
      audioData,
      additionalAudioTracks: []
    };
  }

  if (!videoFormat) {
    return null;
  }

  const [videoData, audioData] = await downloadVideoAudioViaSabr({
    config: effectiveConfig,
    videoFormat,
    audioFormat,
    poToken: resolvedPoToken,
    signal,
    videoId,
    tabId,
    onProgress
  });
  const additionalAudioTracks = await downloadExtraAudioTracksViaSabr({
    config: effectiveConfig,
    formats: additionalAudioFormats ?? [],
    poToken: resolvedPoToken,
    signal,
    onProgress
  });

  return {
    videoData,
    audioData,
    additionalAudioTracks
  };
}

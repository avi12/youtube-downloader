import { capturedPoToken, capturedSabrUrl, setPoTokenCredentials } from "./credentials";
import { resolveFormatUrl } from "./stream-fetch";
import { sabrCredentials } from "@/lib/ui/synced-stores.svelte";
import { type AdaptiveFormatItem, DownloadType } from "@/types";

const CREDENTIAL_POLL_INTERVAL_MS = 200;
const CREDENTIAL_POLL_MAX_WAIT_MS = 5000;

export function getExtraAudioFormats({ audioFormats, selectedTrackId }: {
  audioFormats: AdaptiveFormatItem[];
  selectedTrackId: string | undefined;
}) {
  if (!selectedTrackId) {
    return [];
  }

  const seenTrackIds = new Set([selectedTrackId]);
  return audioFormats.filter(format => {
    const trackId = format.audioTrack?.id;
    if (!trackId || seenTrackIds.has(trackId)) {
      return false;
    }

    seenTrackIds.add(trackId);
    return true;
  });
}

function resolveCredentials() {
  let currentPoToken = capturedPoToken;
  let currentSabrUrl = capturedSabrUrl;

  const creds = sabrCredentials.value;
  if (creds?.url) {
    currentSabrUrl = creds.url;
  }

  if (!currentPoToken && creds?.poToken) {
    currentPoToken = creds.poToken;
  }

  if (!currentPoToken || !currentSabrUrl) {
    const elCredentials = document.getElementById("ytdl-sabr-credentials");
    if (elCredentials?.dataset.url) {
      currentSabrUrl = elCredentials.dataset.url;
    }

    if (!currentPoToken && elCredentials?.dataset.poToken) {
      currentPoToken = elCredentials.dataset.poToken;
    }
  }

  if (currentPoToken !== capturedPoToken || currentSabrUrl !== capturedSabrUrl) {
    setPoTokenCredentials({
      poToken: currentPoToken,
      sabrUrl: currentSabrUrl
    });
  }

  return {
    poToken: currentPoToken,
    sabrUrl: currentSabrUrl
  };
}

export async function resolveCredentialsWithRetry() {
  const initial = resolveCredentials();
  if (initial.poToken) {
    return initial;
  }

  const deadline = Date.now() + CREDENTIAL_POLL_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise<void>(resolve => setTimeout(resolve, CREDENTIAL_POLL_INTERVAL_MS));
    const result = resolveCredentials();
    if (result.poToken) {
      return result;
    }
  }

  return resolveCredentials();
}

export function selectFormats({ videoData, type, videoItag, audioItag }: {
  videoData: {
    videoFormats: AdaptiveFormatItem[];
    audioFormats: AdaptiveFormatItem[];
  };
  type: DownloadType;
  videoItag: number | undefined;
  audioItag: number | undefined;
}) {
  const videoFormat = type !== DownloadType.Audio
    ? (videoData.videoFormats.find(format => format.itag === videoItag) ?? videoData.videoFormats[0])
    : null;
  const audioFormat = type !== DownloadType.Video
    ? (videoData.audioFormats.find(format => format.itag === audioItag) ?? videoData.audioFormats[0])
    : null;

  return {
    videoFormat,
    audioFormat
  };
}

export async function preResolveCdnUrls({ type, videoFormat, audioFormat, extraAudioFormats }: {
  type: DownloadType;
  videoFormat: AdaptiveFormatItem | null;
  audioFormat: AdaptiveFormatItem | null;
  extraAudioFormats: AdaptiveFormatItem[];
}) {
  return Promise.all([
    type !== DownloadType.Audio ? resolveFormatUrl(videoFormat) : Promise.resolve(null),
    type !== DownloadType.Video ? resolveFormatUrl(audioFormat) : Promise.resolve(null),
    ...extraAudioFormats.map(format => resolveFormatUrl(format))
  ]);
}

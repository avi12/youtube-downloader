import { capturedPoToken, capturedSabrUrl, setPoTokenCredentials } from "./credentials";
import { resolveFormatUrl } from "./stream-fetch";
import { buildVideoMetadata, generatePoTokenIfNeeded, videoDataCache } from "./video-data";
import { CrossWorldEvent, emitCrossWorldEvent } from "@/lib/messaging/cross-world-events";
import { crossWorldMessenger, CrossWorldMessage } from "@/lib/messaging/cross-world-messenger";
import { CONTENT_OPTIONS, sabrCredentials } from "@/lib/ui/synced-stores.svelte";
import { uint8ToBase64 } from "@/lib/utils/binary";
import { InnertubeClientName, type InnertubePlayerRequest } from "@/lib/youtube/innertube";
import { isVideoDataExpired, orderCaptionsByPreference, stripTrackLangSuffix } from "@/lib/youtube/video-helpers";
import { getYtcfg, YtcfgKey } from "@/lib/youtube/ytcfg";
import {
  type AdaptiveFormatItem,
  type CaptionTrack,
  type DownloadRequest,
  type PlayerResponse,
  DownloadType,
  ProgressType
} from "@/types";

const activeDownloads = new Map<string, AbortController>();

export function cancelActiveDownload(videoId: string) {
  const controller = activeDownloads.get(videoId);
  if (controller) {
    controller.abort();
    activeDownloads.delete(videoId);
  }
}

export function cancelAllActiveDownloads() {
  const videoIds = [...activeDownloads.keys()];
  for (const controller of activeDownloads.values()) {
    controller.abort();
  }
  activeDownloads.clear();
  return videoIds;
}

const MAX_ADDITIONAL_AUDIO_TRACKS = 16;
const CAPTION_FETCH_TIMEOUT_MS = 10_000;

function formatVttTimestamp(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.round((seconds % 1) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function cuesToVtt(cues: TextTrackCueList) {
  const lines = ["WEBVTT", ""];
  for (const cue of cues) {
    if (!(cue instanceof VTTCue)) {
      continue;
    }

    lines.push(`${formatVttTimestamp(cue.startTime)} --> ${formatVttTimestamp(cue.endTime)}`);
    lines.push(cue.text);
    lines.push("");
  }
  return lines.join("\n");
}

async function fetchVttViaTrackElement(url: string) {
  const elVideo = document.querySelector<HTMLVideoElement>("video.html5-main-video");
  if (!elVideo) {
    return null;
  }

  return new Promise<string | null>(resolve => {
    const trackEl = document.createElement("track");
    trackEl.kind = "metadata";
    trackEl.src = url;

    function finish(result: string | null) {
      clearTimeout(timeoutId);
      trackEl.remove();
      resolve(result);
    }

    const timeoutId = setTimeout(() => finish(null), CAPTION_FETCH_TIMEOUT_MS);

    trackEl.addEventListener("load", () => {
      const cues = trackEl.track?.cues;
      finish(cues?.length ? uint8ToBase64(new TextEncoder().encode(cuesToVtt(cues))) : null);
    }, { once: true });

    trackEl.addEventListener("error", () => finish(null), { once: true });

    elVideo.appendChild(trackEl);
    trackEl.track.mode = "hidden";
  });
}

async function fetchFreshCaptionUrls(videoId: string) {
  const apiKey = getYtcfg(YtcfgKey.InnertubeApiKey);
  if (!apiKey) {
    return new Map();
  }

  const visitorData = getYtcfg(YtcfgKey.VisitorData);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": apiKey
  };
  if (visitorData) {
    headers["X-Goog-Visitor-Id"] = visitorData;
  }

  try {
    const resp = await fetch("/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify(
              {
                videoId,
                playbackContext: {
                  contentPlaybackContext: { signatureTimestamp: getYtcfg(YtcfgKey.Sts) }
                },
                context: {
                  client: {
                    clientName: InnertubeClientName.Web,
                    clientVersion: getYtcfg(YtcfgKey.ClientVersion) ?? "",
                    hl: getYtcfg(YtcfgKey.Hl) ?? "en",
                    gl: getYtcfg(YtcfgKey.Gl) ?? "US",
                    visitorData: visitorData ?? ""
                  }
                }
              } satisfies InnertubePlayerRequest
      )
    });
    if (!resp.ok) {
      return new Map();
    }

    const data: PlayerResponse = await resp.json();
    const freshTracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    return new Map(freshTracks.map(track => [track.vssId, track.baseUrl]));
  } catch {
    return new Map();
  }
}

async function fetchCaptionVttData(captionTracks: CaptionTrack[], videoId: string) {
  if (captionTracks.length === 0) {
    return [];
  }

  const freshUrls = await fetchFreshCaptionUrls(videoId);

  const results: (string | null)[] = [];
  for (const track of captionTracks) {
    const baseUrl = freshUrls.get(track.vssId) ?? track.baseUrl;
    const url = new URL(baseUrl);
    url.searchParams.set("fmt", "vtt");
    results.push(await fetchVttViaTrackElement(url.toString()));
  }
  return results;
}

function getExtraAudioFormats({ audioFormats, selectedTrackId, selectedFormat }: {
  audioFormats: AdaptiveFormatItem[];
  selectedTrackId: string | undefined;
  selectedFormat: AdaptiveFormatItem | null;
}) {
  const seenTrackIds = new Set(selectedTrackId ? [selectedTrackId] : []);
  // If the primary is untagged (original language), mark it as already represented
  // so we skip other untagged formats. If the primary is a dubbed track, we still
  // want to include the original untagged track as an extra.
  let hasUntaggedExtra = !selectedTrackId;
  const result: AdaptiveFormatItem[] = [];
  for (const format of audioFormats) {
    if (result.length >= MAX_ADDITIONAL_AUDIO_TRACKS) {
      break;
    }

    if (format === selectedFormat) {
      continue;
    }

    const trackId = format.audioTrack?.id;
    if (!trackId) {
      if (hasUntaggedExtra) {
        continue;
      }

      hasUntaggedExtra = true;
      result.push(format);
      continue;
    }

    if (seenTrackIds.has(trackId)) {
      continue;
    }

    seenTrackIds.add(trackId);
    result.push(format);
  }

  return result;
}

function resolveCredentials() {
  const creds = sabrCredentials.value;
  const elCredentials = document.getElementById("ytdl-sabr-credentials");

  const currentPoToken =
    creds?.poToken ||
    elCredentials?.dataset.poToken ||
    capturedPoToken;

  const currentSabrUrl =
    creds?.url ||
    elCredentials?.dataset.url ||
    capturedSabrUrl;
  const credentialsChanged = currentPoToken !== capturedPoToken || currentSabrUrl !== capturedSabrUrl;
  if (credentialsChanged) {
    setPoTokenCredentials({
      poToken: currentPoToken ?? "",
      sabrUrl: currentSabrUrl ?? ""
    });
  }

  return {
    poToken: currentPoToken,
    sabrUrl: currentSabrUrl
  };
}

const CREDENTIAL_POLL_INTERVAL_MS = 200;
const CREDENTIAL_POLL_MAX_WAIT_MS = 5000;

async function resolveCredentialsWithRetry() {
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

function selectFormats({ videoData, type, videoItag, audioItag, audioTrackId }: {
  videoData: {
    videoFormats: AdaptiveFormatItem[];
    audioFormats: AdaptiveFormatItem[];
  };
  type: DownloadType;
  videoItag: number | undefined;
  audioItag: number | undefined;
  audioTrackId: string | undefined;
}) {
  const videoFormat = type !== DownloadType.Audio
    ? (videoData.videoFormats.find(format => format.itag === videoItag) ?? videoData.videoFormats[0])
    : null;

  let audioFormat: AdaptiveFormatItem | null = null;
  if (type !== DownloadType.Video) {
    const byItag = videoData.audioFormats.filter(format => format.itag === audioItag);
    audioFormat = (audioTrackId
      ? byItag.find(format => format.audioTrack?.id === audioTrackId)
      : null)
      ?? byItag[0]
      ?? videoData.audioFormats[0];
  }

  return {
    videoFormat,
    audioFormat
  };
}

async function preResolveCdnUrls({ type, videoFormat, audioFormat, extraAudioFormats }: {
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

export async function performDownload({
  type,
  videoId,
  videoItag,
  audioItag,
  audioTrackId,
  filenameOutput,
  isIframeFallback,
  playlistId,
  playlistTitle,
  playlistTotalCount
}: Pick<DownloadRequest, "type" | "videoId" | "videoItag" | "audioItag" | "audioTrackId" | "filenameOutput" | "isIframeFallback" | "playlistId" | "playlistTitle" | "playlistTotalCount">) {
  const isInvalidIframeFallback = isIframeFallback && self === top;
  if (isInvalidIframeFallback) {
    return;
  }

  cancelActiveDownload(videoId);
  const abortController = new AbortController();
  activeDownloads.set(videoId, abortController);

  emitCrossWorldEvent({
    type: CrossWorldEvent.ProgressUpdate,
    data: {
      videoId,
      progress: 0,
      progressType: ProgressType.Video,
      isRemoved: false
    }
  });

  try {
    const cachedVideoData = videoDataCache.get(videoId);
    if (!cachedVideoData) {
      console.error("[ytdl] No video data cached for", videoId);
      return;
    }

    const shouldFetchViaIframe = self === top && isVideoDataExpired(cachedVideoData);
    if (shouldFetchViaIframe) {
      void crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadViaIframe, {
        type,
        videoId,
        videoItag,
        audioItag,
        audioTrackId,
        filenameOutput,
        isIframeFallback: true,
        playlistId,
        playlistTitle,
        playlistTotalCount
      });
      return;
    }

    const options = CONTENT_OPTIONS.value;
    const orderedCaptionTracks = orderCaptionsByPreference({
      captionTracks: cachedVideoData.captionTracks,
      languageMode: options.audioTrackLanguageMode,
      locale: document.documentElement.lang,
      browserLanguage: navigator.language
    });
    const captionVttDataPromise = fetchCaptionVttData(orderedCaptionTracks, videoId);

    const { videoFormat, audioFormat } = selectFormats({
      videoData: cachedVideoData,
      type,
      videoItag,
      audioItag,
      audioTrackId
    });
    const extraAudioFormats = getExtraAudioFormats({
      audioFormats: cachedVideoData.audioFormats,
      selectedTrackId: audioFormat?.audioTrack?.id,
      selectedFormat: audioFormat
    });
    await generatePoTokenIfNeeded(cachedVideoData);
    const credentials = await resolveCredentialsWithRetry();

    const [resolvedVideoUrl, resolvedAudioUrl, ...resolvedExtraAudioUrls] =
      await preResolveCdnUrls({
        type,
        videoFormat,
        audioFormat,
        extraAudioFormats
      });
    const metadata = await buildVideoMetadata(videoId);

    const enrichedRequest: DownloadRequest = {
      type,
      videoId,
      videoItag,
      audioItag,
      filenameOutput,
      isIframeFallback,
      sabrConfig: cachedVideoData.sabrConfig,
      poToken: credentials.poToken,
      sabrUrl: credentials.sabrUrl,
      videoFormat,
      audioFormat,
      additionalAudioFormats: extraAudioFormats,
      primaryAudioLabel: stripTrackLangSuffix(audioFormat?.audioTrack?.displayName ?? ""),
      primaryAudioLanguageCode: audioFormat?.audioTrack?.id?.split(".")[0] ?? "",
      captionTracks: orderedCaptionTracks,
      captionVttData: await captionVttDataPromise,
      metadata,
      resolvedVideoUrl,
      resolvedAudioUrl,
      resolvedExtraAudioUrls,
      playlistId,
      playlistTitle,
      playlistTotalCount
    };
    if (abortController.signal.aborted) {
      return;
    }

    void crossWorldMessenger.sendMessage(CrossWorldMessage.StartBackgroundDownload, {
      requestJson: JSON.stringify(enrichedRequest)
    });
  } catch (error) {
    if (abortController.signal.aborted) {
      return;
    }

    throw error;
  } finally {
    activeDownloads.delete(videoId);
  }
}

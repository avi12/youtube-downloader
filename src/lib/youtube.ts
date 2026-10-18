const WATCH_HOSTS = new Set(["www.youtube.com", "youtube.com", "m.youtube.com", "music.youtube.com"]);
const VIDEO_ID_PATTERN = /^[\w-]{11}$/;
const SHORT_URL_PATH_PATTERN = /^\/(?:shorts|embed|live|v)\/([\w-]{11})/;
const VISITOR_DATA_PATTERN = /"VISITOR_DATA":"([^"]+)"/;
const INNERTUBE_PLAYER_URL = "https://www.youtube.com/youtubei/v1/player";
const YOUTUBE_HOME_URL = "https://www.youtube.com/";
const YOUTUBE_ORIGIN = "https://www.youtube.com";
const CDN_ORIGIN_RULE_ID = 1;
const PLAYER_HEADERS_RULE_ID = 2;
const PLAYER_URL_FILTER = "||www.youtube.com/youtubei/v1/player";
const ANDROID_VR_CLIENT_NAME_ID = "28";
const GOOGLEVIDEO_URL_FILTER = "*.googlevideo.com/videoplayback*";
const VIDEO_HEIGHT_WEIGHT = 1e9;

const ANDROID_VR_CLIENT = {
  clientName: "ANDROID_VR",
  clientVersion: "1.65.10",
  deviceMake: "Oculus",
  deviceModel: "Quest 3",
  androidSdkVersion: 32,
  userAgent: "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L) gzip",
  osName: "Android",
  osVersion: "12L",
  hl: "en",
  gl: "US"
};

export type StreamFormat = {
  itag: number;
  url: string;
  mimeType: string;
  bitrate: number;
  contentLength?: string;
  height?: number;
  audioTrack?: { id: string; displayName: string };
};

type CaptionTrack = {
  baseUrl: string;
  languageCode: string;
  name?: { simpleText?: string };
};

type PlayerResponse = {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: { title?: string };
  streamingData?: { adaptiveFormats?: StreamFormat[] };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
};

export type CaptionOption = {
  languageCode: string;
  label: string;
  url: string;
};

export type ResolvedVideo = {
  title: string;
  videos: StreamFormat[];
  audios: StreamFormat[];
  captions: CaptionOption[];
};

export function parseVideoId(input: string) {
  const trimmed = input.trim();
  if (VIDEO_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }

  const url = URL.parse(trimmed);
  if (!url) {
    return null;
  }

  if (url.hostname === "youtu.be") {
    return url.pathname.slice(1, 12) || null;
  }

  if (!WATCH_HOSTS.has(url.hostname)) {
    return null;
  }

  return url.searchParams.get("v") ?? url.pathname.match(SHORT_URL_PATH_PATTERN)?.[1] ?? null;
}

const YOUTUBE_ORIGIN_HEADERS = [
  { header: "Origin", operation: "set", value: YOUTUBE_ORIGIN },
  { header: "Referer", operation: "set", value: `${YOUTUBE_ORIGIN}/` },
  { header: "Sec-Fetch-Site", operation: "set", value: "cross-site" }
] satisfies Browser.declarativeNetRequest.ModifyHeaderInfo[];

const BROWSER_FINGERPRINT_HEADERS = ["sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform", "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site"];

const PLAYER_HEADERS = [
  { header: "Origin", operation: "set", value: YOUTUBE_ORIGIN },
  ...BROWSER_FINGERPRINT_HEADERS.map(header => ({ header, operation: "remove" }) as const),
  { header: "User-Agent", operation: "set", value: ANDROID_VR_CLIENT.userAgent },
  { header: "X-YouTube-Client-Name", operation: "set", value: ANDROID_VR_CLIENT_NAME_ID },
  { header: "X-YouTube-Client-Version", operation: "set", value: ANDROID_VR_CLIENT.clientVersion }
] satisfies Browser.declarativeNetRequest.ModifyHeaderInfo[];

function buildHeaderRule(id: number, urlFilter: string, requestHeaders: Browser.declarativeNetRequest.ModifyHeaderInfo[]) {
  return {
    id,
    action: { type: "modifyHeaders", requestHeaders },
    condition: { urlFilter, initiatorDomains: [browser.runtime.id] }
  } satisfies Browser.declarativeNetRequest.Rule;
}

export async function registerRequestHeaderRules() {
  await browser.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [CDN_ORIGIN_RULE_ID, PLAYER_HEADERS_RULE_ID],
    addRules: [
      buildHeaderRule(CDN_ORIGIN_RULE_ID, GOOGLEVIDEO_URL_FILTER, YOUTUBE_ORIGIN_HEADERS),
      buildHeaderRule(PLAYER_HEADERS_RULE_ID, PLAYER_URL_FILTER, PLAYER_HEADERS)
    ]
  });
}

async function fetchVisitorData() {
  const html = await (await fetch(YOUTUBE_HOME_URL)).text();
  const visitorData = html.match(VISITOR_DATA_PATTERN)?.[1];
  if (!visitorData) {
    throw new Error("Couldn't read visitor data from youtube.com");
  }

  return visitorData;
}

async function fetchPlayerResponse(videoId: string) {
  const visitorData = await fetchVisitorData();
  const response = await fetch(INNERTUBE_PLAYER_URL, {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      context: { client: { ...ANDROID_VR_CLIENT, visitorData } },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true
    })
  });
  if (!response.ok) {
    throw new Error(`Player request failed: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
  }

  const playerResponse: PlayerResponse = await response.json();
  const { status, reason } = playerResponse.playabilityStatus ?? {};
  if (status !== "OK") {
    throw new Error(`Video isn't playable: ${status} ${reason ?? ""}`);
  }

  return playerResponse;
}

const DEFAULT_AUDIO_TRACK_ID = "default";

function isMp4(format: StreamFormat) {
  return format.mimeType.includes("mp4");
}

function bestPerKey(formats: StreamFormat[], getKey: (format: StreamFormat) => string, score: (format: StreamFormat) => number) {
  const sorted = formats.toSorted((first, second) => score(second) - score(first));
  const best = new Map<string, StreamFormat>();
  for (const format of sorted) {
    const key = getKey(format);
    if (!best.has(key)) {
      best.set(key, format);
    }
  }
  return [...best.values()];
}

function scoreVideo(format: StreamFormat) {
  return (format.height ?? 0) * VIDEO_HEIGHT_WEIGHT + Number(isMp4(format)) * (VIDEO_HEIGHT_WEIGHT / 2) + format.bitrate;
}
function scoreAudio(format: StreamFormat) {
  return Number(isMp4(format)) * VIDEO_HEIGHT_WEIGHT + format.bitrate;
}

function toVttUrl(baseUrl: string) {
  const url = new URL(baseUrl);
  url.searchParams.set("fmt", "vtt");
  return url.href;
}

export async function resolveVideo(videoId: string): Promise<ResolvedVideo> {
  const playerResponse = await fetchPlayerResponse(videoId);
  const formats = playerResponse.streamingData?.adaptiveFormats ?? [];
  const videoFormats = formats.filter(format => format.mimeType.startsWith("video/"));
  const audioFormats = formats.filter(format => format.mimeType.startsWith("audio/"));
  const captionTracks = playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  return {
    title: playerResponse.videoDetails?.title ?? videoId,
    videos: bestPerKey(videoFormats, format => String(format.height), scoreVideo),
    audios: bestPerKey(audioFormats, format => format.audioTrack?.id ?? DEFAULT_AUDIO_TRACK_ID, scoreAudio),
    captions: captionTracks.map(track => ({
      languageCode: track.languageCode,
      label: track.name?.simpleText ?? track.languageCode,
      url: toVttUrl(track.baseUrl)
    }))
  };
}

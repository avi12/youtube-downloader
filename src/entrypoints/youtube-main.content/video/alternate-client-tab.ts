// User-tab side alternate-client: when the WEB player_response gives only
// SABR-only formats (no `url` field), call /youtubei/v1/player with a mobile
// or TV client identity to get plain CDN URLs. Runs in MAIN world so it
// has access to:
//   - document.cookie (__Secure-3PAPISID for SAPISIDHASH auth)
//   - window.ytcfg (visitorData, INNERTUBE_CONTEXT)
// Sends to youtubei.googleapis.com (mobile-app endpoint) which accepts the
// non-WEB clientNames the www.youtube.com proxy rejects.

interface AdaptiveFormat {
  itag: number;
  url?: string;
  mimeType?: string;
  contentLength?: string;
  approxDurationMs?: string;
}

interface PlayerResponse {
  streamingData?: {
    adaptiveFormats?: AdaptiveFormat[];
    formats?: AdaptiveFormat[];
  };
  playabilityStatus?: {
    status?: string;
    reason?: string;
  };
}

interface ClientSpec {
  clientName: string;
  clientNameHeader: string;
  clientVersion: string;
  context: Record<string, unknown>;
}

const TV_EMBED_CLIENT: ClientSpec = {
  clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
  clientNameHeader: "85",
  clientVersion: "2.0",
  context: {
    osName: "Tizen",
    osVersion: "1.0"
  }
};

const IOS_CLIENT: ClientSpec = {
  clientName: "IOS",
  clientNameHeader: "5",
  clientVersion: "20.10.4",
  context: {
    deviceMake: "Apple",
    deviceModel: "iPhone16,2",
    osName: "iPhone",
    osVersion: "18.1.0.22B83",
    userAgent: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)"
  }
};

const MWEB_CLIENT: ClientSpec = {
  clientName: "MWEB",
  clientNameHeader: "2",
  clientVersion: "2.20240101.00.00",
  context: {
    deviceMake: "Apple",
    deviceModel: "iPhone16,2",
    osName: "iOS",
    osVersion: "18.1.0",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.85 Mobile/15E148 Safari/605.1.15"
  }
};

const CLIENT_CHAIN: ClientSpec[] = [TV_EMBED_CLIENT, IOS_CLIENT, MWEB_CLIENT];

async function buildSapiSidHash(): Promise<string | null> {
  const sapiSid = document.cookie.split(";")
    .map(cookie => cookie.trim())
    .find(cookie => cookie.startsWith("__Secure-3PAPISID="))
    ?.split("=")[1];
  if (!sapiSid) {
    return null;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${timestamp} ${sapiSid} https://www.youtube.com`;
  const hashBuffer = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(message));
  const hash = Array.from(new Uint8Array(hashBuffer))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
  return `SAPISIDHASH ${timestamp}_${hash}`;
}

interface YtcfgRoot {
  data_?: {
    INNERTUBE_CONTEXT?: {
      client?: {
        visitorData?: string;
      };
    };
  };
}

function readVisitorData(): string {
  const ytcfg = (window as Window & { ytcfg?: YtcfgRoot }).ytcfg;
  return ytcfg?.data_?.INNERTUBE_CONTEXT?.client?.visitorData ?? "";
}

async function fetchClient({ client, videoId }: {
  client: ClientSpec;
  videoId: string;
}): Promise<AdaptiveFormat[] | null> {
  const visitorData = readVisitorData();
  const body: Record<string, unknown> = {
    context: {
      client: {
        clientName: client.clientName,
        clientVersion: client.clientVersion,
        hl: "en",
        gl: "US",
        ...(visitorData ? { visitorData } : {}),
        ...client.context
      }
    },
    videoId,
    playbackContext: {
      contentPlaybackContext: { html5Preference: "HTML5_PREF_WANTS" }
    },
    racyCheckOk: true,
    contentCheckOk: true
  };

  const authorization = await buildSapiSidHash();
  const response = await fetch(
    `https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Youtube-Client-Name": client.clientNameHeader,
        "X-Youtube-Client-Version": client.clientVersion,
        ...(visitorData ? { "X-Goog-Visitor-Id": visitorData } : {}),
        ...(authorization ? { Authorization: authorization } : {})
      },
      body: JSON.stringify(body)
    }
  ).catch(() => null);
  if (!response?.ok) {
    return null;
  }

  const data: PlayerResponse = await response.json().catch(() => ({}));
  const playabilityStatus = data.playabilityStatus?.status;
  if (playabilityStatus && playabilityStatus !== "OK") {
    console.log(`[ytdl:tab-alt-client] ${client.clientName} playability=${playabilityStatus}`);
    return null;
  }

  const formats = [
    ...(data.streamingData?.adaptiveFormats ?? []),
    ...(data.streamingData?.formats ?? [])
  ];
  if (!formats.some(format => format.url)) {
    console.log(`[ytdl:tab-alt-client] ${client.clientName} no URL-bearing formats`);
    return null;
  }

  console.log(`[ytdl:tab-alt-client] ${client.clientName} OK (${formats.length} formats)`);
  return formats;
}

export async function fetchAlternateClientFormatsFromTab(videoId: string): Promise<AdaptiveFormat[] | null> {
  for (const client of CLIENT_CHAIN) {
    const formats = await fetchClient({ client, videoId });
    if (formats) {
      return formats;
    }
  }

  return null;
}

export function findFormatUrlByItag(formats: AdaptiveFormat[], itag: number) {
  return formats.find(format => format.itag === itag)?.url ?? null;
}

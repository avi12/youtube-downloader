/**
 * yt-dlp-style fallback: when the watch page's WEB client returns SABR-only
 * formats and YouTube's attestation wall blocks SABR on Firefox, fetch the
 * player response via an embedded-TV client instead. TVHTML5_SIMPLY_EMBEDDED
 * does not gate playback on PO tokens and returns formats with plain
 * `url` fields, so we can stream them directly through the existing CDN
 * path without needing UMP/SABR at all.
 *
 * This is the same technique yt-dlp uses to keep working when YouTube
 * flips a client into attestation-required mode.
 */

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

// Try multiple alternate clients in sequence, return formats from the first
// that succeeds with non-SABR URLs. yt-dlp's strategy: each client is gated
// differently, so cycling through ANDROID_VR / TVHTML5_SIMPLY_EMBEDDED / IOS
// / MWEB tends to find one that returns plain URLs.

interface ClientSpec {
  clientName: string;
  clientVersion: string;
  clientNameHeader: string;
  context: Record<string, unknown>;
}

// SAPISIDHASH auth — same scheme YouTube's own pages use. Reads __Secure-3PAPISID
// from the YouTube cookie jar via the BG cookies API, then signs the request
// with sha1(timestamp + ' ' + sapiSid + ' ' + origin) as Authorization header.
// Skips `credentials: "include"` so the request looks identical to logged-in
// browser traffic without leaking cookies through the extension's request path.
async function buildSapiSidHash(): Promise<string | null> {
  const cookie = await browser.cookies.get({
    url: "https://www.youtube.com",
    name: "__Secure-3PAPISID"
  }).catch(() => null);
  if (!cookie?.value) {
    return null;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${timestamp} ${cookie.value} https://www.youtube.com`;
  const hashBuffer = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(message));
  const hash = Array.from(new Uint8Array(hashBuffer))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
  return `SAPISIDHASH ${timestamp}_${hash}`;
}

const TV_EMBED_CLIENT: ClientSpec = {
  clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
  clientNameHeader: "85",
  clientVersion: "2.0",
  context: {
    osName: "Tizen",
    osVersion: "1.0",
    userAgent: "Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/5.0 Safari/605.1.15"
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

const CLIENT_CHAIN: ClientSpec[] = [
  TV_EMBED_CLIENT,
  IOS_CLIENT,
  MWEB_CLIENT
];

async function fetchClient({ client, videoId, poToken }: {
  client: ClientSpec;
  videoId: string;
  poToken: string;
}): Promise<AdaptiveFormat[] | null> {
  const body: Record<string, unknown> = {
    context: {
      client: {
        clientName: client.clientName,
        clientVersion: client.clientVersion,
        hl: "en",
        gl: "US",
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
  if (poToken) {
    body.serviceIntegrityDimensions = { poToken };
  }

  const authorization = await buildSapiSidHash();
  const userAgent = (client.context as { userAgent?: string }).userAgent;
  // youtubei.googleapis.com is the canonical innertube endpoint; the
  // www.youtube.com proxy rejects mobile-app client identities with HTTP 400.
  // The googleapis hostname accepts them when paired with SAPISIDHASH auth +
  // matching User-Agent header.
  // Hard 10s timeout: network can hang silently (e.g. when host_permissions
  // for googleapis.com aren't granted yet) and would otherwise block the
  // entire download flow before iframe-scrub fallback gets a chance to run.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(
      `https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Youtube-Client-Name": client.clientNameHeader,
          "X-Youtube-Client-Version": client.clientVersion,
          ...(userAgent ? { "User-Agent": userAgent } : {}),
          ...(authorization ? { Authorization: authorization } : {})
        },
        body: JSON.stringify(body)
      }
    );
  } catch (error) {
    console.log(`[ytdl:alt-client] ${client.clientName} fetch threw: ${String(error)}`);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok) {
    console.log(`[ytdl:alt-client] ${client.clientName} HTTP ${response.status} (auth=${Boolean(authorization)})`);
    return null;
  }

  const data: PlayerResponse = await response.json();
  const playabilityStatus = data.playabilityStatus?.status;
  if (playabilityStatus && playabilityStatus !== "OK") {
    console.log(`[ytdl:alt-client] ${client.clientName} playability=${playabilityStatus} reason=${data.playabilityStatus?.reason ?? ""}`);
    return null;
  }

  const formats = [
    ...(data.streamingData?.adaptiveFormats ?? []),
    ...(data.streamingData?.formats ?? [])
  ];
  if (!formats.some(format => format.url)) {
    console.log(`[ytdl:alt-client] ${client.clientName} returned ${formats.length} formats but all are SABR-only (no url field)`);
    return null;
  }

  console.log(`[ytdl:alt-client] ${client.clientName} OK (${formats.length} formats, auth=${Boolean(authorization)})`);
  return formats;
}

export async function fetchAlternateClientFormats({ videoId, poToken }: {
  videoId: string;
  poToken: string;
}): Promise<AdaptiveFormat[]> {
  for (const client of CLIENT_CHAIN) {
    const formats = await fetchClient({ client, videoId, poToken }).catch(() => null);
    if (formats) {
      console.log(`[ytdl:bg] alternate-client ${client.clientName} succeeded (${formats.length} formats)`);
      return formats;
    }

    console.log(`[ytdl:bg] alternate-client ${client.clientName} failed; trying next`);
  }

  throw new Error("All alternate clients failed");
}

export function findFormatUrlByItag(formats: AdaptiveFormat[], itag: number) {
  return formats.find(format => format.itag === itag)?.url ?? null;
}

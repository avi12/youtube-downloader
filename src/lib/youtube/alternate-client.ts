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

const ANDROID_VR_CLIENT: ClientSpec = {
  clientName: "ANDROID_VR",
  clientNameHeader: "28",
  clientVersion: "1.65.10",
  context: {
    deviceMake: "Oculus",
    deviceModel: "Quest 3",
    osName: "Android",
    osVersion: "12L",
    androidSdkVersion: 32,
    userAgent: "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip"
  }
};

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
  ANDROID_VR_CLIENT,
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

  const response = await fetch(
    `https://www.youtube.com/youtubei/v1/player?prettyPrint=false`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Youtube-Client-Name": client.clientNameHeader,
        "X-Youtube-Client-Version": client.clientVersion
      },
      credentials: "include",
      body: JSON.stringify(body)
    }
  );
  if (!response.ok) {
    return null;
  }

  const data: PlayerResponse = await response.json();
  const playabilityStatus = data.playabilityStatus?.status;
  if (playabilityStatus && playabilityStatus !== "OK") {
    return null;
  }

  const formats = [
    ...(data.streamingData?.adaptiveFormats ?? []),
    ...(data.streamingData?.formats ?? [])
  ];
  // Reject responses without any URL-bearing formats (still SABR-only).
  if (!formats.some(format => format.url)) {
    return null;
  }

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

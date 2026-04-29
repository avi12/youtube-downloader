import { buildSapiSidHash, CLIENT_CHAIN, type ClientSpec } from "./alternate-client-specs";
import type { AdaptiveFormatItem } from "@/types";

interface PlayerResponse {
  streamingData?: {
    adaptiveFormats?: AdaptiveFormatItem[];
    formats?: AdaptiveFormatItem[];
  };
  playabilityStatus?: {
    status?: string;
    reason?: string;
  };
}

async function fetchClient({ client, videoId, poToken }: {
  client: ClientSpec;
  videoId: string;
  poToken: string;
}): Promise<AdaptiveFormatItem[] | null> {
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
  const userAgentField = client.context.userAgent;
  const userAgent = typeof userAgentField === "string" ? userAgentField : undefined;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(
      "https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false",
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
}): Promise<AdaptiveFormatItem[]> {
  for (const client of CLIENT_CHAIN) {
    const formats = await fetchClient({
      client,
      videoId,
      poToken
    }).catch(() => null);
    if (formats) {
      console.log(`[ytdl:bg] alternate-client ${client.clientName} succeeded (${formats.length} formats)`);
      return formats;
    }

    console.log(`[ytdl:bg] alternate-client ${client.clientName} failed; trying next`);
  }

  throw new Error("All alternate clients failed");
}

export function findFormatUrlByItag(formats: AdaptiveFormatItem[], itag: number) {
  return formats.find(format => format.itag === itag)?.url ?? null;
}

export function findExtraAudioFormatUrl(formats: AdaptiveFormatItem[], itag: number, trackId: string | undefined) {
  const match = formats.find(format =>
    format.itag === itag &&
    format.audioTrack?.id === trackId) ?? formats.find(format => format.itag === itag);
  return match?.url ?? null;
}

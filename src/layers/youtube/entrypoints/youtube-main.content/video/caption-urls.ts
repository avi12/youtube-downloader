import { InnertubeClientName, type InnertubePlayerRequest } from "@/lib/youtube/innertube";
import { playerResponseSchema } from "@/lib/youtube/schemas";
import { getYtcfg, YtcfgKey } from "#youtube/lib/youtube/ytcfg";

const PLAYER_API_PATH = "/youtubei/v1/player?prettyPrint=false";
const HEADER_CONTENT_TYPE = "Content-Type";
const HEADER_GOOG_API_KEY = "X-Goog-Api-Key";
const HEADER_GOOG_VISITOR_ID = "X-Goog-Visitor-Id";
const CONTENT_TYPE_JSON = "application/json";
const DEFAULT_CAPTION_LANGUAGE = "en";
const DEFAULT_CAPTION_REGION = "US";

export async function fetchFreshCaptionUrls(videoId: string) {
  const apiKey = getYtcfg(YtcfgKey.InnertubeApiKey);
  if (!apiKey) {
    return new Map<string, string>();
  }

  const visitorData = getYtcfg(YtcfgKey.VisitorData);
  const headers: Record<string, string> = {
    [HEADER_CONTENT_TYPE]: CONTENT_TYPE_JSON,
    [HEADER_GOOG_API_KEY]: apiKey
  };
  if (visitorData) {
    headers[HEADER_GOOG_VISITOR_ID] = visitorData;
  }

  try {
    const response = await fetch(PLAYER_API_PATH, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({
        videoId,
        playbackContext: {
          contentPlaybackContext: {
            signatureTimestamp: getYtcfg(YtcfgKey.Sts)
          }
        },
        context: {
          client: {
            clientName: InnertubeClientName.Web,
            clientVersion: getYtcfg(YtcfgKey.ClientVersion) ?? "",
            hl: getYtcfg(YtcfgKey.Hl) ?? DEFAULT_CAPTION_LANGUAGE,
            gl: getYtcfg(YtcfgKey.Gl) ?? DEFAULT_CAPTION_REGION,
            visitorData: visitorData ?? ""
          }
        }
      } satisfies InnertubePlayerRequest)
    });
    if (!response.ok) {
      return new Map<string, string>();
    }

    const data = playerResponseSchema.parse(await response.json());
    const freshTracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    return new Map(freshTracks.map(track => [track.vssId, track.baseUrl]));
  } catch {
    return new Map<string, string>();
  }
}

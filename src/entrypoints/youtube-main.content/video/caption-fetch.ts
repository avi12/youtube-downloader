import { fetchFreshCaptionUrls } from "./caption-urls";
import { uint8ToBase64 } from "@/lib/utils/binary";
import { type CaptionTrack } from "@/types";

export { resolveOrderedCaptionTracks } from "./caption-urls";

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;
const CAPTION_FETCH_TIMEOUT_MS = 10_000;
const HTML5_MAIN_VIDEO_SELECTOR = "video.html5-main-video";
const CAPTION_FORMAT_PARAM = "fmt";
const CAPTION_TLANG_PARAM = "tlang";

type CaptionFormat = "vtt" | "json3" | "srv1" | "srv2" | "srv3" | "ttml" | "sbv";
const CAPTION_FORMAT_VTT: CaptionFormat = "vtt";

type CaptionBaseParams = { [CAPTION_FORMAT_PARAM]: CaptionFormat };
type CaptionTranslatedParams = CaptionBaseParams & { [CAPTION_TLANG_PARAM]: string };

function formatWebVttTimestamp(seconds: number) {
  const hours = Math.floor(seconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const remainingSeconds = Math.floor(seconds % SECONDS_PER_MINUTE);
  const milliseconds = Math.round((seconds % 1) * MILLISECONDS_PER_SECOND);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function cuesToWebVtt(cues: TextTrackCueList) {
  const lines = ["WEBVTT", ""];
  for (const cue of cues) {
    if (!(cue instanceof VTTCue)) {
      continue;
    }

    lines.push(`${formatWebVttTimestamp(cue.startTime)} --> ${formatWebVttTimestamp(cue.endTime)}`);
    lines.push(cue.text);
    lines.push("");
  }
  return lines.join("\n");
}

async function fetchWebVttViaTrackElement(url: string) {
  const elVideo = document.querySelector<HTMLVideoElement>(HTML5_MAIN_VIDEO_SELECTOR);
  if (!elVideo) {
    return null;
  }

  return new Promise<string | null>(resolve => {
    const elTrack = document.createElement("track");
    elTrack.kind = "metadata";
    elTrack.src = url;

    function finish(result: string | null) {
      clearTimeout(timeoutId);
      elTrack.remove();
      resolve(result);
    }

    const timeoutId = setTimeout(() => finish(null), CAPTION_FETCH_TIMEOUT_MS);

    elTrack.addEventListener("load", () => {
      const cues = elTrack.track?.cues;
      finish(cues?.length ? uint8ToBase64(new TextEncoder().encode(cuesToWebVtt(cues))) : null);
    }, { once: true });

    elTrack.addEventListener("error", () => finish(null), { once: true });

    elVideo.append(elTrack);
    elTrack.track.mode = "hidden";
  });
}

type FetchCaptionWebVttDataParams = {
  captionTracks: CaptionTrack[];
  videoId: string;
};
export async function fetchCaptionWebVttData({ captionTracks, videoId }: FetchCaptionWebVttDataParams) {
  const isCaptionTracksPresent = captionTracks.length > 0;
  if (!isCaptionTracksPresent) {
    return [];
  }

  const freshUrls = await fetchFreshCaptionUrls(videoId);

  return Promise.all(
    captionTracks.map(track => {
      const translationLanguageCode = track.translationLanguageCode;
      const sourceVssId = translationLanguageCode ? track.sourceTrackVssId! : track.vssId;
      const baseUrl = freshUrls.get(sourceVssId) ?? track.baseUrl;
      const url = new URL(baseUrl);
      const params: CaptionBaseParams | CaptionTranslatedParams = translationLanguageCode
        ? {
          [CAPTION_FORMAT_PARAM]: CAPTION_FORMAT_VTT,
          [CAPTION_TLANG_PARAM]: translationLanguageCode
        }
        : { [CAPTION_FORMAT_PARAM]: CAPTION_FORMAT_VTT };
      url.search = new URLSearchParams(params).toString();

      return fetchWebVttViaTrackElement(url.toString());
    })
  );
}

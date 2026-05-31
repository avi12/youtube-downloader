import { fetchFreshCaptionUrls } from "./caption-urls";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { uint8ToBase64 } from "@/lib/utils/binary";
import { ProgressType, type CaptionTrack } from "@/types";

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
type CaptionParams = CaptionBaseParams | CaptionTranslatedParams;

const TWO_DIGIT_PAD = 2;
const THREE_DIGIT_PAD = 3;
const PAD_CHAR = "0";

function formatWebVttTimestamp(seconds: number) {
  const hours = Math.floor(seconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const remainingSeconds = Math.floor(seconds % SECONDS_PER_MINUTE);
  const milliseconds = Math.round((seconds % 1) * MILLISECONDS_PER_SECOND);

  const hoursPadded = String(hours).padStart(TWO_DIGIT_PAD, PAD_CHAR);
  const minutesPadded = String(minutes).padStart(TWO_DIGIT_PAD, PAD_CHAR);
  const secondsPadded = String(remainingSeconds).padStart(TWO_DIGIT_PAD, PAD_CHAR);
  const millisecondsPadded = String(milliseconds).padStart(THREE_DIGIT_PAD, PAD_CHAR);

  return `${hoursPadded}:${minutesPadded}:${secondsPadded}.${millisecondsPadded}`;
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
  captionBytesPerUnit: number;
  totalExpectedBytes: number;
};
export async function fetchCaptionWebVttData({
  captionTracks, videoId, captionBytesPerUnit, totalExpectedBytes
}: FetchCaptionWebVttDataParams) {
  const hasCaptionTracks = captionTracks.length > 0;
  if (!hasCaptionTracks) {
    return [];
  }

  const freshUrls = await fetchFreshCaptionUrls(videoId);

  const results: (string | null)[] = [];
  for (const [iTrack, track] of captionTracks.entries()) {
    const isTranslated = !!track.translationLanguageCode;
    const sourceVssId = isTranslated ? track.sourceTrackVssId! : track.vssId;
    const baseUrl = freshUrls.get(sourceVssId) ?? track.baseUrl;
    const url = new URL(baseUrl);
    url.searchParams.set(CAPTION_FORMAT_PARAM, CAPTION_FORMAT_VTT);

    if (isTranslated) {
      url.searchParams.set(CAPTION_TLANG_PARAM, track.translationLanguageCode!);
    }

    results.push(await fetchWebVttViaTrackElement(url.toString()));

    const isTotalKnown = totalExpectedBytes > 0;
    if (isTotalKnown) {
      const progress = ((iTrack + 1) * captionBytesPerUnit) / totalExpectedBytes;
      void crossWorldMessenger.sendMessage(CrossWorldMessage.ReportPageProgress, {
        videoId,
        progress,
        progressType: ProgressType.Video
      });
    }
  }
  return results;
}

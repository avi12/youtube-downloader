import { fetchFreshCaptionUrls } from "./caption-urls";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { uint8ToBase64 } from "@/lib/utils/binary";
import { ProgressType, type CaptionTrack } from "@/types";

export { resolveOrderedCaptionTracks } from "./caption-urls";

const CAPTION_FETCH_TIMEOUT_MS = 10_000;
const HTML5_MAIN_VIDEO_SELECTOR = "video.html5-main-video";
const CAPTION_FORMAT_PARAM = "fmt";
const CAPTION_FORMAT_VTT = "vtt";
const CAPTION_TLANG_PARAM = "tlang";

function formatWebVttTimestamp(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  const milliseconds = Math.round((seconds % 1) * 1000);
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
  totalStages?: number;
};
export async function fetchCaptionWebVttData({ captionTracks, videoId, totalStages }: FetchCaptionWebVttDataParams) {
  const hasCaptionTracks = captionTracks.length > 0;
  if (!hasCaptionTracks) {
    return [];
  }

  const freshUrls = await fetchFreshCaptionUrls(videoId);
  const captionStagesAcrossTotal = totalStages && totalStages > 0 ? totalStages : captionTracks.length;

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

    const progress = (iTrack + 1) / captionStagesAcrossTotal;
    void crossWorldMessenger.sendMessage(CrossWorldMessage.ReportPageProgress, {
      videoId,
      progress,
      progressType: ProgressType.Video
    });
  }
  return results;
}

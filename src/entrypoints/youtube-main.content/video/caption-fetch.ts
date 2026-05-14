import { fetchFreshCaptionUrls } from "./caption-urls";
import { uint8ToBase64 } from "@/lib/utils/binary";
import { type CaptionTrack } from "@/types";

export { resolveOrderedCaptionTracks } from "./caption-urls";

const CAPTION_FETCH_TIMEOUT_MS = 10_000;

function formatWebVttTimestamp(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.round((seconds % 1) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
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
  const elVideo = document.querySelector<HTMLVideoElement>("video.html5-main-video");
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

export async function fetchCaptionWebVttData(captionTracks: CaptionTrack[], videoId: string) {
  if (captionTracks.length === 0) {
    return [];
  }

  const freshUrls = await fetchFreshCaptionUrls(videoId);

  const results: (string | null)[] = [];
  for (const track of captionTracks) {
    const baseUrl = freshUrls.get(track.vssId) ?? track.baseUrl;
    const url = new URL(baseUrl);
    url.searchParams.set("fmt", "vtt");
    results.push(await fetchWebVttViaTrackElement(url.toString()));
  }
  return results;
}

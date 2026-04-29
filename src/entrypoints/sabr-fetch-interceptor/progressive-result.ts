import type { ProgressiveFetchResult, ProgressiveState } from "./types";
import { buildContiguousBytes } from "./ump-ingestion";

export function buildResult({ state, audioItag, videoItag, iterations, stalled }: {
  state: ProgressiveState;
  audioItag: number;
  videoItag: number;
  iterations: number;
  stalled: boolean;
}): ProgressiveFetchResult {
  return {
    audioBytes: buildContiguousBytes(state.audio),
    videoBytes: buildContiguousBytes(state.video),
    audioCoveredMs: state.audio.endMs,
    videoCoveredMs: state.video.endMs,
    audioItag,
    videoItag,
    iterations,
    stalled,
    carryState: {
      audioEndMs: state.audio.endMs,
      audioLastSeq: state.audio.lastSeq,
      videoEndMs: state.video.endMs,
      videoLastSeq: state.video.lastSeq,
      audioSegmentBytes: state.audio.segmentBytes,
      videoSegmentBytes: state.video.segmentBytes,
      playbackCookieBytes: state.playbackCookieBytes
    }
  };
}

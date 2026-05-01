import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";

// Direct postMessage channel for BG-hosted iframes. Firefox doesn't inject
// content scripts into iframes whose top-level document is moz-extension://,
// so the cross-world → ISOLATED → runtime.sendMessage relay is silently
// dropped. parent.postMessage works regardless because postMessage is a DOM
// primitive that crosses any origin; the BG document hosts the iframe and
// listens for these messages directly.
const POST_MESSAGE_TYPE_DEBUG = "ytdl:scrub-debug";
const POST_MESSAGE_TYPE_SEGMENT = "ytdl:scrub-segment";

function postToHost(payload: unknown, transferables: Transferable[] = []) {
  if (parent === self) {
    return;
  }

  try {
    parent.postMessage(payload, "*", transferables);
  } catch {
    // cross-origin postMessage may throw in some contexts
  }
}

export function scrubLog(msg: string) {
  console.log(`[ytdl:scrub-tab] ${msg}`);
  void crossWorldMessenger.sendMessage(CrossWorldMessage.IframeScrubDebug, {
    msg: `[ytdl:scrub-tab] ${msg}`
  });
  postToHost({
    type: POST_MESSAGE_TYPE_DEBUG,
    msg: `[ytdl:scrub-tab] ${msg}`
  });
}

export function sendEmptyResult({ videoId, scrubIndex }: {
  videoId: string;
  scrubIndex: number;
}) {
  void crossWorldMessenger.sendMessage(CrossWorldMessage.IframeScrubSegment, {
    videoId,
    scrubIndex,
    videoBytes: new Uint8Array(),
    audioBytes: new Uint8Array(),
    videoMimeType: "",
    audioMimeType: ""
  });
  postToHost({
    type: POST_MESSAGE_TYPE_SEGMENT,
    videoId,
    scrubIndex,
    videoBuffer: new ArrayBuffer(0),
    audioBuffer: new ArrayBuffer(0),
    videoMimeType: "",
    audioMimeType: ""
  });
}

export function sendCapturedResult({
  videoId, scrubIndex, videoBuffer, audioBuffer, videoMimeType, audioMimeType, videoBufferEndSec
}: {
  videoId: string;
  scrubIndex: number;
  videoBuffer: ArrayBuffer;
  audioBuffer: ArrayBuffer;
  videoMimeType: string;
  audioMimeType: string;
  videoBufferEndSec: number;
}) {
  void crossWorldMessenger.sendMessage(CrossWorldMessage.IframeScrubSegment, {
    videoId,
    scrubIndex,
    videoBytes: new Uint8Array(videoBuffer),
    audioBytes: new Uint8Array(audioBuffer),
    videoMimeType,
    audioMimeType
  });
  postToHost({
    type: POST_MESSAGE_TYPE_SEGMENT,
    videoId,
    scrubIndex,
    videoBuffer,
    audioBuffer,
    videoMimeType,
    audioMimeType,
    videoBufferEndSec
  }, [videoBuffer, audioBuffer]);
}

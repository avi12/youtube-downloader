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

export function sendEmptyResult({ videoId, iScrub }: {
  videoId: string;
  iScrub: number;
}) {
  void crossWorldMessenger.sendMessage(CrossWorldMessage.IframeScrubSegment, {
    videoId,
    iScrub,
    videoBytes: new Uint8Array(),
    audioBytes: new Uint8Array(),
    videoMimeType: "",
    audioMimeType: ""
  });
  postToHost({
    type: POST_MESSAGE_TYPE_SEGMENT,
    videoId,
    iScrub,
    videoBuffer: new ArrayBuffer(0),
    audioBuffer: new ArrayBuffer(0),
    videoMimeType: "",
    audioMimeType: ""
  });
}

export function sendCapturedResult({
  videoId, iScrub, videoBytes, audioBytes, videoMimeType, audioMimeType, videoBufferEndSec
}: {
  videoId: string;
  iScrub: number;
  videoBytes: Uint8Array;
  audioBytes: Uint8Array;
  videoMimeType: string;
  audioMimeType: string;
  videoBufferEndSec: number;
}) {
  const videoBuffer = videoBytes.buffer.slice(videoBytes.byteOffset, videoBytes.byteOffset + videoBytes.byteLength);
  const audioBuffer = audioBytes.buffer.slice(audioBytes.byteOffset, audioBytes.byteOffset + audioBytes.byteLength);
  void crossWorldMessenger.sendMessage(CrossWorldMessage.IframeScrubSegment, {
    videoId,
    iScrub,
    videoBytes,
    audioBytes,
    videoMimeType,
    audioMimeType
  });
  postToHost({
    type: POST_MESSAGE_TYPE_SEGMENT,
    videoId,
    iScrub,
    videoBuffer,
    audioBuffer,
    videoMimeType,
    audioMimeType,
    videoBufferEndSec
  }, [videoBuffer, audioBuffer]);
}

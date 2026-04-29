import { concatChunks } from "./capture";
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
    // best-effort
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

export function emitCapturedSegment({ videoId, scrubIndex, captured, videoBufferStartSec }: {
  videoId: string;
  scrubIndex: number;
  captured: NonNullable<ReturnType<NonNullable<typeof window.__ytdlCapture>["capturedMedia"]["get"]>>;
  videoBufferStartSec?: number;
}) {
  const videoConcat = concatChunks(captured.videoChunks);
  const audioConcat = concatChunks(captured.audioChunks);

  void crossWorldMessenger.sendMessage(CrossWorldMessage.IframeScrubSegment, {
    videoId,
    scrubIndex,
    videoBytes: videoConcat,
    audioBytes: audioConcat,
    videoMimeType: captured.videoMimeType,
    audioMimeType: captured.audioMimeType,
    videoBufferStartSec
  });

  // Slice the underlying buffers so we don't transfer the whole pool when
  // chunks live in shared backing storage; copy is cheap relative to
  // concat itself.
  const videoBuffer = videoConcat.buffer.slice(
    videoConcat.byteOffset,
    videoConcat.byteOffset + videoConcat.byteLength
  );
  const audioBuffer = audioConcat.buffer.slice(
    audioConcat.byteOffset,
    audioConcat.byteOffset + audioConcat.byteLength
  );
  postToHost({
    type: POST_MESSAGE_TYPE_SEGMENT,
    videoId,
    scrubIndex,
    videoBuffer,
    audioBuffer,
    videoMimeType: captured.videoMimeType,
    audioMimeType: captured.audioMimeType,
    videoBufferStartSec
  }, [videoBuffer, audioBuffer]);
}

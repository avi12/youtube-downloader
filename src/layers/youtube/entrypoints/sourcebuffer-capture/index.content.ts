import { patchIframeMediaVolume, patchSourceBuffer } from "./sourcebuffer-capture-patches";
import { isDownloadFrame } from "@/lib/youtube/download-frame";
import type { YtdlCaptureState, YtdlMediaCapture } from "@/types";

const MIME_PREFIX_VIDEO = "video";

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  runAt: "document_start",
  allFrames: true,
  main() {
    const isUnrelatedIframe = self !== top && !isDownloadFrame();
    if (isUnrelatedIframe) {
      return;
    }

    if (isDownloadFrame()) {
      patchIframeMediaVolume();
    }

    const sourceBufferMimeTypes = new WeakMap<SourceBuffer, string>();

    function addChunkToCapture({ capture, mimeType, chunk }: {
      capture: YtdlMediaCapture;
      mimeType: string;
      chunk: Uint8Array;
    }) {
      if (mimeType.startsWith(MIME_PREFIX_VIDEO)) {
        capture.videoChunks.push(chunk.slice());
        capture.videoTotalBytes += chunk.byteLength;
        capture.videoMimeType = mimeType;
      } else {
        capture.audioChunks.push(chunk.slice());
        capture.audioTotalBytes += chunk.byteLength;
        capture.audioMimeType = mimeType;
      }
    }

    const captureState: YtdlCaptureState = {
      activeVideoId: "",
      pendingChunks: [],
      capturedMedia: new Map(),
      sourceBufferMimeTypes,
      addChunkToCapture
    };

    window.__ytdlCapture = captureState;
    patchSourceBuffer(captureState);
  }
});

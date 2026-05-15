// Must run at document_start because YouTube creates SourceBuffers before document_idle;
// patching later means sourceBufferMimeTypes is empty and appendBuffer captures nothing.
import { patchIframeMediaVolume, patchSourceBuffer } from "./sourcebuffer-capture-patches";
import type { YtdlCaptureState, YtdlMediaCapture } from "@/types";

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  runAt: "document_start",
  allFrames: true,
  main() {
    const isUnrelatedIframe = self !== top && !/ytdl=1/.test(location.search);
    if (isUnrelatedIframe) {
      return;
    }

    const isDownloadIframe = self !== top;
    if (isDownloadIframe) {
      patchIframeMediaVolume();
    }

    const sourceBufferMimeTypes = new WeakMap<SourceBuffer, string>();

    function addChunkToCapture({ capture, mimeType, chunk }: {
      capture: YtdlMediaCapture;
      mimeType: string;
      chunk: Uint8Array;
    }) {
      if (mimeType.startsWith("video")) {
        capture.videoChunks.push(chunk.slice());
        capture.videoTotalBytes += chunk.byteLength;
        capture.videoMimeType = mimeType.split(";")[0];
      } else {
        capture.audioChunks.push(chunk.slice());
        capture.audioTotalBytes += chunk.byteLength;
        capture.audioMimeType = mimeType.split(";")[0];
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

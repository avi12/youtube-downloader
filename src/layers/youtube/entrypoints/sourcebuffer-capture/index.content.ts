import { patchIframeMediaVolume, patchSourceBuffer } from "./sourcebuffer-capture-patches";
import type { YtdlCaptureState, YtdlMediaCapture } from "@/types";

const YTDL_IFRAME_QUERY_PARAM = "ytdl=1";
const MIME_PREFIX_VIDEO = "video";

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  runAt: "document_start",
  allFrames: true,
  main() {
    const isUnrelatedIframe = self !== top && !location.search.includes(YTDL_IFRAME_QUERY_PARAM);
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

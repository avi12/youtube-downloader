import { forwardToIframe, initIframeMessageRelay, removeIframe, spawnIframe } from "./iframe-host-receiver";
import { handleProcessStreamChunk } from "./stream/accumulator";
import { handleProcessStreamEnd } from "./stream/end-handler";
import { cancelDownloadsByIds, initFFmpeg } from "@/lib/download-pipeline";
import { FFmpegWorkerClient } from "@/lib/download-pipeline/ffmpeg-worker-client";
import { transcodeRecentDownload } from "@/lib/download-pipeline/transcode-recent";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, listenForOffscreenMessages } from "@/lib/messaging/offscreen-messaging";

// Register the port listener BEFORE spawning the worker so any runtime.connect
// fired immediately after signalFFmpegReady hits a registered handler.
initIframeMessageRelay();
listenForOffscreenMessages({
  [OffscreenMessageType.ProcessStreamChunk]: handleProcessStreamChunk,
  [OffscreenMessageType.ProcessStreamEnd]: handleProcessStreamEnd,
  [OffscreenMessageType.CancelProcessing](data) {
    void cancelDownloadsByIds(data.videoIds);
  },
  [OffscreenMessageType.TranscodeRecentDownload](data) {
    void transcodeRecentDownload(data);
  },
  [OffscreenMessageType.SpawnIframe]: spawnIframe,
  [OffscreenMessageType.RemoveIframe]: removeIframe,
  [OffscreenMessageType.ForwardToIframe]: forwardToIframe
});

void sendMessage(MessageType.BgDebugLog, { msg: "[ytdl:offscreen] main.ts starting, spawning FFmpeg worker" });

// Pre-fetch the WASM binary on the main thread (Emscripten's internal fetch
// hangs indefinitely in Firefox background-page iframes) then transfer it to
// the worker so it never needs to fetch it itself.
try {
  const wasmUrl = browser.runtime.getURL("/node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm");
  void sendMessage(MessageType.BgDebugLog, { msg: `[ytdl:offscreen] fetching WASM from ${wasmUrl}` });
  const wasmResp = await fetch(wasmUrl);
  void sendMessage(MessageType.BgDebugLog, { msg: `[ytdl:offscreen] WASM fetch ok=${wasmResp.ok} status=${wasmResp.status}` });
  const wasmBinary = await wasmResp.arrayBuffer();
  void sendMessage(MessageType.BgDebugLog, { msg: `[ytdl:offscreen] WASM binary loaded: ${wasmBinary.byteLength}B, loading worker` });
  const worker = new Worker(new URL("./ffmpeg-worker.ts", import.meta.url), { type: "module" });
  const client = new FFmpegWorkerClient(worker);
  await client.load(wasmBinary);
  void sendMessage(MessageType.BgDebugLog, { msg: "[ytdl:offscreen] FFmpeg worker ready, calling initFFmpeg" });
  initFFmpeg(client);
} catch (error) {
  void sendMessage(MessageType.BgDebugLog, { msg: `[ytdl:offscreen] FAILED: ${String(error)}` });
}

import { forwardToIframe, removeIframe, spawnIframe } from "./iframe-host-receiver";
import { handleProcessStreamChunk } from "./stream/accumulator";
import { handleProcessStreamEnd } from "./stream/end-handler";
import { cancelDownloadsByIds, initFFmpeg } from "@/lib/download-pipeline";
import { transcodeRecentDownload } from "@/lib/download-pipeline/transcode-recent";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, listenForOffscreenMessages } from "@/lib/messaging/offscreen-messaging";
import createFFmpegCore from "@ffmpeg/core";
import { browser } from "#imports";

const FFMPEG_CORE_WASM_URL = "/node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm";

// Register the port listener BEFORE awaiting createFFmpegCore so that the BG
// orchestrator's first runtime.connect (fired from emitSegmentChunks right
// after signalFFmpegReady resolves ensureProcessor) hits a registered handler
// instead of getting silently dropped.
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

void sendMessage(MessageType.BgDebugLog, { msg: `[ytdl:offscreen] main.ts starting, typeof createFFmpegCore=${typeof createFFmpegCore}` });

// Pre-fetch the WASM binary ourselves and pass it in via the `wasmBinary`
// option. Emscripten's internal fetch inside createFFmpegCore hangs
// indefinitely in Firefox background-page iframes; bypassing it with a
// pre-fetched ArrayBuffer avoids the hang.
try {
  const wasmUrl = browser.runtime.getURL("/node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm");
  void sendMessage(MessageType.BgDebugLog, { msg: `[ytdl:offscreen] fetching WASM from ${wasmUrl}` });
  const wasmResp = await fetch(wasmUrl);
  void sendMessage(MessageType.BgDebugLog, { msg: `[ytdl:offscreen] WASM fetch ok=${wasmResp.ok} status=${wasmResp.status}` });
  const wasmBinary = await wasmResp.arrayBuffer();
  void sendMessage(MessageType.BgDebugLog, { msg: `[ytdl:offscreen] WASM binary loaded: ${wasmBinary.byteLength}B, calling createFFmpegCore` });
  const core = await createFFmpegCore({ wasmBinary });
  void sendMessage(MessageType.BgDebugLog, { msg: "[ytdl:offscreen] createFFmpegCore resolved, calling initFFmpeg" });
  initFFmpeg(core);
} catch (error) {
  void sendMessage(MessageType.BgDebugLog, { msg: `[ytdl:offscreen] FAILED: ${String(error)}` });
}

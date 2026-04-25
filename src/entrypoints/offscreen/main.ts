import { removeIframe, spawnIframe } from "./iframe-host-receiver";
import { handleProcessStreamChunk } from "./stream/accumulator";
import { handleProcessStreamEnd } from "./stream/end-handler";
import { cancelDownloadsByIds, initFFmpeg } from "@/lib/download-pipeline";
import { transcodeRecentDownload } from "@/lib/download-pipeline/transcode-recent";
import { OffscreenMessageType, listenForOffscreenMessages } from "@/lib/messaging/offscreen-messaging";
import createFFmpegCore from "@ffmpeg/core";
import { browser } from "#imports";

const FFMPEG_CORE_WASM_URL = "/node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm";

const wasmBinary = await fetch(browser.runtime.getURL(FFMPEG_CORE_WASM_URL)).then(res => res.arrayBuffer());
const core = await createFFmpegCore({ wasmBinary });
initFFmpeg(core);

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
  [OffscreenMessageType.RemoveIframe]: removeIframe
});

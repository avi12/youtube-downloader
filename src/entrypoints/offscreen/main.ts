import { handleProcessStreamChunk } from "./stream/accumulator";
import { handleProcessStreamEnd } from "./stream/end-handler";
import { cancelDownloadsByIds, initFFmpeg } from "@/lib/download-pipeline";
import { transcodeRecentDownload } from "@/lib/download-pipeline/transcode-recent";
import { OffscreenMessageType, listenForOffscreenMessages } from "@/lib/messaging/offscreen-messaging";
import type { FFmpegCoreModuleFactory } from "@ffmpeg/types";

// Loaded via <script> tag in index.html; the UMD build sets this global
// and resolves ffmpeg-core.wasm relative to document.currentScript.src.
declare const createFFmpegCore: FFmpegCoreModuleFactory;

const core = await createFFmpegCore({});
initFFmpeg(core);

listenForOffscreenMessages({
  [OffscreenMessageType.ProcessStreamChunk]: handleProcessStreamChunk,
  [OffscreenMessageType.ProcessStreamEnd]: handleProcessStreamEnd,
  [OffscreenMessageType.CancelProcessing](data) {
    void cancelDownloadsByIds(data.videoIds);
  },
  [OffscreenMessageType.TranscodeRecentDownload](data) {
    void transcodeRecentDownload(data);
  }
});

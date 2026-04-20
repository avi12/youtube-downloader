import { handleProcessStreamChunk } from "./stream/accumulator";
import { handleProcessStreamEnd } from "./stream/end-handler";
import { cancelDownloadsByIds, initFFmpeg } from "@/lib/download-pipeline";
import { transcodeRecentDownload } from "@/lib/download-pipeline/transcode-recent";
import { OffscreenMessageType, listenForOffscreenMessages } from "@/lib/messaging/offscreen-messaging";
import type { FFmpegCoreModuleFactory } from "@ffmpeg/types";
import { browser } from "#imports";

// Loaded via <script type="module"> in index.html; the UMD build sets this global.
// locateFile is required because document.currentScript is null in module scripts.
declare const createFFmpegCore: FFmpegCoreModuleFactory;

const FFMPEG_CORE_URLS = {
  "ffmpeg-core.js": "/node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js",
  "ffmpeg-core.wasm": "/node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm"
} as const;
type FFmpegCoreFile = keyof typeof FFMPEG_CORE_URLS;

function isCoreFile(path: string): path is FFmpegCoreFile {
  return path in FFMPEG_CORE_URLS;
}

const core = await createFFmpegCore({
  locateFile: path => browser.runtime.getURL(
    isCoreFile(path) ? FFMPEG_CORE_URLS[path] : "/node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js"
  )
});
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

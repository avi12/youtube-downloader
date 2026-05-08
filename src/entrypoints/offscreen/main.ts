import { createDownloadIframe, removeDownloadIframe } from "./iframe-host";
import { handleProcessStreamChunk } from "./stream/accumulator";
import { handleProcessStreamEnd } from "./stream/end-handler";
import { cancelDownloadsByIds, initFFmpeg } from "@/lib/download-pipeline";
import { transcodeRecentDownload } from "@/lib/download-pipeline/transcode-recent";
import { OffscreenMessageType, listenForOffscreenMessages } from "@/lib/messaging/offscreen-messaging";
// @ts-expect-error @ffmpeg/core ships no .d.ts; we type it via @ffmpeg/types below
import createFFmpegCoreUntyped from "@ffmpeg/core";
import type { FFmpegCoreModule, FFmpegCoreModuleFactory } from "@ffmpeg/types";
import { browser } from "#imports";

const createFFmpegCore: FFmpegCoreModuleFactory = createFFmpegCoreUntyped;
const wasmBinary = await fetch(
  browser.runtime.getURL("/node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm")
).then(res => res.arrayBuffer());
const core = await createFFmpegCore({ wasmBinary } as Partial<FFmpegCoreModule>);
initFFmpeg(core);

listenForOffscreenMessages({
  [OffscreenMessageType.ProcessStreamChunk]: handleProcessStreamChunk,
  [OffscreenMessageType.ProcessStreamEnd]: handleProcessStreamEnd,
  [OffscreenMessageType.CancelProcessing](data) {
    void cancelDownloadsByIds(data.videoIds);
    for (const videoId of data.videoIds) {
      removeDownloadIframe(videoId);
    }
  },
  [OffscreenMessageType.TranscodeRecentDownload](data) {
    void transcodeRecentDownload(data);
  },
  [OffscreenMessageType.CreateDownloadIframe](data) {
    createDownloadIframe(data);
  },
  [OffscreenMessageType.RemoveDownloadIframe](data) {
    removeDownloadIframe(data.videoId);
  }
});

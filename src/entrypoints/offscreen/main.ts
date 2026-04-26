import { removeIframe, spawnIframe } from "./iframe-host-receiver";
import { handleProcessStreamChunk } from "./stream/accumulator";
import { handleProcessStreamEnd } from "./stream/end-handler";
import { cancelDownloadsByIds, initFFmpeg } from "@/lib/download-pipeline";
import { transcodeRecentDownload } from "@/lib/download-pipeline/transcode-recent";
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
  [OffscreenMessageType.RemoveIframe]: removeIframe
});

const core = await createFFmpegCore({});
initFFmpeg(core);

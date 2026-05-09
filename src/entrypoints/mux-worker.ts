import {
  WorkerMessageType,
  type EmbedMetadataJob,
  type MuxVideoAudioJob,
  type TranscodeAudioJob,
  type TranscodeFileJob
} from "@/lib/download-pipeline/mux-worker-types";
import { createWorkerPortReceiver } from "@/lib/download-pipeline/worker-port";
import type { WorkerPortReceiver } from "@/lib/download-pipeline/worker-port";
import {
  CONTAINER_SPECS,
  extractBaseCodec,
  getAudioTempExtension,
  getCompatibleFilename,
  getFileExtension,
  getVideoTempExtension,
  isVideoNativeForContainer,
  videoContainers
} from "@/lib/utils/containers";
import { ProgressType } from "@/types";
import type { FFmpegCoreModule } from "@ffmpeg/types";

type InitMessage = {
  type: WorkerMessageType.Init;
  wasmBinary: ArrayBuffer;
  port: MessagePort;
};

// ---------------------------------------------------------------------------
// FFmpeg state
// ---------------------------------------------------------------------------

type FFmpegFactory = (options: { wasmBinary: ArrayBuffer }) => Promise<FFmpegCoreModule>;
let ffmpeg: FFmpegCoreModule | null = null;
let portReceiver: WorkerPortReceiver | null = null;
let progressOffset = 0;
let progressScale = 1;
let currentVideoId = "";
let currentTabId = 0;

function tryUnlink(filename: string) {
  try {
    ffmpeg!.FS.unlink(filename);
  } catch {
    // file was never written
  }
}

function reportFFmpegProgress(value: number) {
  portReceiver?.send(WorkerMessageType.Progress, {
    videoId: currentVideoId,
    progress: Math.max(0, Math.min(value, 0.99)),
    progressType: ProgressType.FFmpeg,
    tabId: currentTabId
  });
}

function postResult(data: Uint8Array | null) {
  if (!data) {
    portReceiver!.send(WorkerMessageType.Result, { data: null });
    return;
  }

  if (!(data.buffer instanceof ArrayBuffer)) {
    portReceiver!.send(WorkerMessageType.Error, { message: "Unexpected SharedArrayBuffer in result" });
    return;
  }

  const copy = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  portReceiver!.send(WorkerMessageType.Result, { data: copy }, [copy]);
}

function postError(message: string) {
  portReceiver!.send(WorkerMessageType.Error, { message });
}

// ---------------------------------------------------------------------------
// FFmpeg helpers
// ---------------------------------------------------------------------------

function resolveAudioCodec(audioMimeType: string, targetExtension: string) {
  const spec = CONTAINER_SPECS[targetExtension];
  if (!spec) {
    return "copy";
  }

  const codec = extractBaseCodec(audioMimeType);
  return spec.audioCodecs.has(codec) ? "copy" : (spec.fallbackAudioCodec ?? "copy");
}

function resolveSubtitleCodec(targetExtension: string) {
  return CONTAINER_SPECS[targetExtension]?.subtitleCodec ?? "webvtt";
}

// ---------------------------------------------------------------------------
// Music metadata helpers (inlined from music-metadata.ts)
// ---------------------------------------------------------------------------

function matchesMagicBytes(data: Uint8Array, bytes: number[], offset = 0) {
  return bytes.every((byte, i) => data[offset + i] === byte);
}

const JPEG_MAGIC_BYTES = [0xFF, 0xD8, 0xFF];
const PNG_MAGIC_BYTES = [0x89, 0x50, 0x4E, 0x47];
const RIFF_MAGIC_BYTES = [0x52, 0x49, 0x46, 0x46];
const WEBP_MAGIC_BYTES = [0x57, 0x45, 0x42, 0x50];
const WEBP_MAGIC_OFFSET = 8;

function detectImageExtension(data: Uint8Array) {
  if (matchesMagicBytes(data, JPEG_MAGIC_BYTES)) {
    return "jpg";
  }

  if (matchesMagicBytes(data, PNG_MAGIC_BYTES)) {
    return "png";
  }

  if (matchesMagicBytes(data, RIFF_MAGIC_BYTES) && matchesMagicBytes(data, WEBP_MAGIC_BYTES, WEBP_MAGIC_OFFSET)) {
    return "webp";
  }

  return "jpg";
}

function preferJpegThumbnail(url: string) {
  return url.replace("/vi_webp/", "/vi/").replace(/\.webp(\?|$)/, ".jpg$1");
}

async function fetchThumbnail(url: string) {
  try {
    const response = await fetch(preferJpegThumbnail(url));
    if (!response.ok) {
      return null;
    }

    const data = new Uint8Array(await response.arrayBuffer());
    return {
      data,
      extension: detectImageExtension(data)
    };
  } catch {
    return null;
  }
}

function sanitizeForFFmpeg(value: string) {
  return value.replaceAll(/[\n\r"\\]/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Job handlers
// ---------------------------------------------------------------------------

function handleMuxVideoAudio(job: MuxVideoAudioJob) {
  const {
    videoData, audioData, extraAudioTracks, subtitleTracks,
    videoMimeType, audioMimeType, videoId, tabId, primaryAudioLabel, filenameOutput
  } = job;
  currentVideoId = videoId;
  currentTabId = tabId;

  const AUDIO_EXTRA_PREFIX = "audio-extra";
  const videoExtension = getVideoTempExtension(videoMimeType);
  const audioExtension = getAudioTempExtension(audioMimeType);
  const isExtraTracksPresent = extraAudioTracks.length > 0;
  const filenameBase = filenameOutput.replace(/\.[^.]+$/, "");
  const targetExtension = isExtraTracksPresent ? "mkv" : (filenameOutput.split(".").pop() ?? "mkv");
  const downloadFilename = `${filenameBase}.${targetExtension}`;
  const videoFilename = `${videoId}-video.${videoExtension}`;
  const primaryAudioFilename = `${videoId}-audio.${audioExtension}`;
  const muxFilename = getCompatibleFilename(`${videoId}-mux.mkv`);
  const outputFilename = targetExtension !== "mkv"
    ? getCompatibleFilename(`${videoId}-${downloadFilename}`)
    : muxFilename;

  const isNativeToTarget = targetExtension === "mkv" || isVideoNativeForContainer(videoMimeType, targetExtension);
  const useIntermediateMkv = targetExtension !== "mkv" && !isNativeToTarget;

  progressOffset = 0;
  progressScale = useIntermediateMkv ? 0.5 : 1;

  const extraFilenames: string[] = [];
  const subtitleFilenames: string[] = [];

  try {
    ffmpeg!.FS.writeFile(videoFilename, new Uint8Array(videoData));
    ffmpeg!.FS.writeFile(primaryAudioFilename, new Uint8Array(audioData));

    for (const [i, track] of extraAudioTracks.entries()) {
      const extraExtension = getAudioTempExtension("audio/mp4");
      const extraFilename = `${videoId}-${AUDIO_EXTRA_PREFIX}-${i}.${extraExtension}`;
      ffmpeg!.FS.writeFile(extraFilename, new Uint8Array(track.data));
      extraFilenames.push(extraFilename);
    }

    for (const [i, track] of subtitleTracks.entries()) {
      const subFilename = `${videoId}-sub-${i}.vtt`;
      ffmpeg!.FS.writeFile(subFilename, track.data);
      subtitleFilenames.push(subFilename);
    }

    const ffmpegArgs = ["-i", videoFilename, "-i", primaryAudioFilename];
    for (const filename of extraFilenames) {
      ffmpegArgs.push("-i", filename);
    }

    for (const filename of subtitleFilenames) {
      ffmpegArgs.push("-i", filename);
    }

    ffmpegArgs.push("-map", "0:v:0");
    for (let i = 0; i <= extraAudioTracks.length; i++) {
      ffmpegArgs.push("-map", `${i + 1}:a:0`);
    }

    const subtitleInputOffset = 2 + extraAudioTracks.length;
    for (let i = 0; i < subtitleFilenames.length; i++) {
      ffmpegArgs.push("-map", `${subtitleInputOffset + i}:s:0`);
    }

    const phase1AudioCodec = useIntermediateMkv ? "copy" : resolveAudioCodec(audioMimeType, targetExtension);
    const phase1SubtitleCodec = useIntermediateMkv ? "webvtt" : resolveSubtitleCodec(targetExtension);
    ffmpegArgs.push("-c:v", "copy", "-c:a", phase1AudioCodec);

    if (subtitleFilenames.length > 0) {
      ffmpegArgs.push("-c:s", phase1SubtitleCodec);
    }

    const audioTrackLabels = [primaryAudioLabel, ...extraAudioTracks.map(track => track.label)];
    for (const [i, label] of audioTrackLabels.entries()) {
      if (label) {
        ffmpegArgs.push(`-metadata:s:a:${i}`, `title=${label}`);
      }
    }

    for (const [i, track] of subtitleTracks.entries()) {
      if (track.label) {
        ffmpegArgs.push(`-metadata:s:s:${i}`, `title=${track.label}`);
      }

      if (track.languageCode) {
        ffmpegArgs.push(`-metadata:s:s:${i}`, `language=${track.languageCode}`);
      }
    }

    const phase1Output = useIntermediateMkv ? muxFilename : outputFilename;
    ffmpegArgs.push(phase1Output);

    const phase1Code = ffmpeg!.exec(...ffmpegArgs);
    if (phase1Code !== 0) {
      postError(`FFmpeg phase 1 exited with code ${phase1Code}`);
      return;
    }

    if (useIntermediateMkv) {
      progressOffset = 0.5;
      progressScale = 0.5;
      const audioCodec = resolveAudioCodec(audioMimeType, targetExtension);
      const subtitleCodec = resolveSubtitleCodec(targetExtension);
      const phase2Args = ["-i", muxFilename, "-c:v", "copy", "-c:a", audioCodec];
      if (subtitleFilenames.length > 0) {
        phase2Args.push("-c:s", subtitleCodec);
      }

      phase2Args.push(outputFilename);
      const phase2Code = ffmpeg!.exec(...phase2Args);
      if (phase2Code !== 0) {
        postError(`FFmpeg phase 2 exited with code ${phase2Code}`);
        return;
      }
    }

    const output = ffmpeg!.FS.readFile(outputFilename, { encoding: "binary" });
    if (typeof output === "string") {
      postError("FFmpeg readFile returned unexpected string output");
      return;
    }

    postResult(output);
  } finally {
    tryUnlink(videoFilename);
    tryUnlink(primaryAudioFilename);
    for (const filename of extraFilenames) {
      tryUnlink(filename);
    }

    for (const filename of subtitleFilenames) {
      tryUnlink(filename);
    }

    if (useIntermediateMkv) {
      tryUnlink(muxFilename);
    }

    if (targetExtension !== "mkv") {
      tryUnlink(outputFilename);
    }
  }
}

async function handleEmbedMetadata(job: EmbedMetadataJob) {
  const { audioData, filenameOutput, sourceExtension, metadata, thumbnailUrl, videoId, tabId } = job;
  currentVideoId = videoId;
  currentTabId = tabId;
  const outputExtension = getFileExtension(filenameOutput) || sourceExtension;
  const inputFilename = `input.${sourceExtension}`;
  const outputFilename = getCompatibleFilename(filenameOutput);

  progressOffset = 0;
  progressScale = 1;

  let coverFilename = "";
  let isCoverArtPresent = false;

  ffmpeg!.FS.writeFile(inputFilename, new Uint8Array(audioData));

  const ffmpegArgs = ["-i", inputFilename];

  const isWebmSource = sourceExtension === "weba" || sourceExtension === "webm";
  const isWebmOutput = outputExtension === "weba" || outputExtension === "webm";
  if (thumbnailUrl && !isWebmSource && !isWebmOutput) {
    const thumbnail = await fetchThumbnail(thumbnailUrl);
    if (thumbnail) {
      coverFilename = `cover.${thumbnail.extension}`;
      ffmpeg!.FS.writeFile(coverFilename, thumbnail.data);
      ffmpegArgs.push("-i", coverFilename);
      isCoverArtPresent = true;
    }
  }

  ffmpegArgs.push("-map", "0:a");

  if (isCoverArtPresent) {
    ffmpegArgs.push("-map", "1");
    const isJpeg = coverFilename.endsWith(".jpg");
    ffmpegArgs.push("-c:v", isJpeg ? "copy" : "mjpeg");
    ffmpegArgs.push("-disposition:v", "attached_pic");
  }

  const audioCodec = outputExtension === "flac" ? "flac" : "copy";
  ffmpegArgs.push("-c:a", audioCodec);
  ffmpegArgs.push("-metadata", `title=${sanitizeForFFmpeg(metadata.title)}`);
  ffmpegArgs.push("-metadata", `artist=${sanitizeForFFmpeg(metadata.artist)}`);

  if (metadata.albumArtist) {
    ffmpegArgs.push("-metadata", `album_artist=${sanitizeForFFmpeg(metadata.albumArtist)}`);
  }

  if (metadata.album) {
    ffmpegArgs.push("-metadata", `album=${sanitizeForFFmpeg(metadata.album)}`);
  }

  if (metadata.genres?.length) {
    ffmpegArgs.push("-metadata", `genre=${sanitizeForFFmpeg(metadata.genres.join(", "))}`);
  }

  if (metadata.date) {
    ffmpegArgs.push("-metadata", `date=${metadata.date}`);
  }

  ffmpegArgs.push(outputFilename);

  try {
    const exitCode = ffmpeg!.exec(...ffmpegArgs);
    if (exitCode !== 0) {
      postResult(new Uint8Array(audioData));
      return;
    }

    const output = ffmpeg!.FS.readFile(outputFilename, { encoding: "binary" });
    if (typeof output === "string" || output.byteLength === 0) {
      postResult(new Uint8Array(audioData));
      return;
    }

    postResult(output);
  } finally {
    tryUnlink(inputFilename);
    tryUnlink(outputFilename);

    if (isCoverArtPresent) {
      tryUnlink(coverFilename);
    }
  }
}

function handleTranscodeAudio(job: TranscodeAudioJob) {
  const { audioData, sourceExtension, filenameOutput, videoId, tabId } = job;
  currentVideoId = videoId;
  currentTabId = tabId;
  const outputExtension = getFileExtension(filenameOutput) || sourceExtension;
  const inputFilename = `input.${sourceExtension}`;
  const outputFilename = getCompatibleFilename(filenameOutput);

  progressOffset = 0;
  progressScale = 1;

  const audioCodecByExtension: Record<string, string> = { flac: "flac" };

  ffmpeg!.FS.writeFile(inputFilename, new Uint8Array(audioData));

  try {
    const codec = audioCodecByExtension[outputExtension] ?? "copy";
    const exitCode = ffmpeg!.exec("-i", inputFilename, "-map", "0:a", "-c:a", codec, outputFilename);
    if (exitCode !== 0) {
      postError(`FFmpeg transcode exited with code ${exitCode}`);
      return;
    }

    const output = ffmpeg!.FS.readFile(outputFilename, { encoding: "binary" });
    if (typeof output === "string" || output.byteLength === 0) {
      postError("FFmpeg transcode produced empty output");
      return;
    }

    postResult(output);
  } finally {
    tryUnlink(inputFilename);
    tryUnlink(outputFilename);
  }
}

function handleTranscodeFile(job: TranscodeFileJob) {
  const { data, sourceExtension, targetContainer } = job;
  const sourceFilename = `source.${sourceExtension}`;
  const outputFilename = `output.${targetContainer}`;

  progressOffset = 0;
  progressScale = 1;

  ffmpeg!.FS.writeFile(sourceFilename, new Uint8Array(data));

  try {
    const args = ["-i", sourceFilename];
    if (videoContainers.includes(targetContainer)) {
      args.push("-c:v", "copy", "-c:a", "copy");
    }

    args.push(outputFilename);
    const exitCode = ffmpeg!.exec(...args);
    if (exitCode !== 0) {
      postError(`FFmpeg exited with code ${exitCode}`);
      return;
    }

    const output = ffmpeg!.FS.readFile(outputFilename, { encoding: "binary" });
    if (typeof output === "string") {
      postError("FFmpeg readFile returned unexpected string output");
      return;
    }

    postResult(output);
  } finally {
    tryUnlink(sourceFilename);
    tryUnlink(outputFilename);
  }
}

// ---------------------------------------------------------------------------
// Bootstrap: receive init message on the global channel, then switch to port
// ---------------------------------------------------------------------------

async function onInitMessage(e: MessageEvent<InitMessage>) {
  if (e.data?.type !== WorkerMessageType.Init) {
    return;
  }

  removeEventListener("message", onInitMessage);
  portReceiver = createWorkerPortReceiver(e.data.port);

  // @ts-expect-error @ffmpeg/core ships no .d.ts; we type it via @ffmpeg/types
  const { default: createFFmpegCoreUntyped } = await import("@ffmpeg/core");
  const createFFmpegCore: FFmpegFactory = createFFmpegCoreUntyped;
  ffmpeg = await createFFmpegCore({ wasmBinary: e.data.wasmBinary });
  ffmpeg.setProgress(({ progress }) => {
    if (progress < 0) {
      return;
    }

    reportFFmpegProgress(progressOffset + progress * progressScale);
  });

  portReceiver.onMessage({
    [WorkerMessageType.MuxVideoAudio]({ job }) {
      try {
        handleMuxVideoAudio(job);
      } catch (error) {
        postError(error instanceof Error ? error.message : String(error));
      }
    },
    [WorkerMessageType.EmbedMetadata]({ job }) {
      void handleEmbedMetadata(job).catch(error => {
        postError(error instanceof Error ? error.message : String(error));
      });
    },
    [WorkerMessageType.TranscodeAudio]({ job }) {
      try {
        handleTranscodeAudio(job);
      } catch (error) {
        postError(error instanceof Error ? error.message : String(error));
      }
    },
    [WorkerMessageType.TranscodeFile]({ job }) {
      try {
        handleTranscodeFile(job);
      } catch (error) {
        postError(error instanceof Error ? error.message : String(error));
      }
    }
  });

  portReceiver.send(WorkerMessageType.Ready, {});
}

export default defineUnlistedScript(() => {
  addEventListener("message", onInitMessage);
});

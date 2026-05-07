import { triggerDownload, reportProgress } from ".";
import { writeExtraInputs } from "./concat-extra-inputs";
import { buildFinalMuxArgs } from "./concat-mux-args";
import { getFFmpeg } from "./ffmpeg-instance";
import { ProgressType } from "@/types";
import type { ProcessStreamData } from "@/types";

type ConcatInput = Pick<
  ProcessStreamData,
  "videoId" | "filenameOutput" | "tabId" | "additionalAudioStreams" | "subtitleStreams" | "primaryAudioLabel" | "totalDurationSec" | "metadata"
>;

export async function concatSegments({
  muxedSegFiles, targetExt, writtenPaths, logEvent, item
}: {
  muxedSegFiles: string[];
  targetExt: string;
  writtenPaths: string[];
  logEvent: (msg: string) => void;
  item: ConcatInput;
}) {
  const ffmpeg = getFFmpeg();
  const {
    videoId, filenameOutput, tabId, additionalAudioStreams, subtitleStreams, primaryAudioLabel, totalDurationSec
  } = item;

  const filenameBase = filenameOutput.replace(/\.[^.]+$/, "");
  const outputFfmpegName = `tmp_out.${targetExt}`;
  const concatListName = "tmp_mux_concat.txt";

  await ffmpeg.FS.writeFile(
    concatListName,
    new TextEncoder().encode(muxedSegFiles.map(filename => `file '${filename}'`).join("\n"))
  );
  writtenPaths.push(concatListName);

  const extraAudioStreams = additionalAudioStreams.filter(stream => Boolean(stream.data));
  const { extraAudioInputs, subtitleInputs } = await writeExtraInputs({
    extraAudioStreams,
    subtitleStreams,
    writtenPaths
  });

  const finalMuxArgs = buildFinalMuxArgs({
    concatListName,
    extraAudioInputs,
    subtitleInputs,
    primaryAudioLabel,
    totalDurationSec,
    outputFfmpegName
  });

  logEvent(`[ytdl:pipeline] final mux: ${muxedSegFiles.length} seg(s) ${1 + extraAudioInputs.length} audio track(s) ${subtitleInputs.length} subtitle(s) duration=${totalDurationSec ?? "unbounded"}s`);

  const muxExit = await ffmpeg.exec(...finalMuxArgs);
  if (muxExit !== 0) {
    throw new Error(`FFmpeg final mux failed (exit ${muxExit})`);
  }

  writtenPaths.push(outputFfmpegName);

  const outputBytes = await ffmpeg.FS.readFile(outputFfmpegName);

  const recentContext = {
    videoId,
    title: item.metadata?.title ?? filenameOutput,
    channel: item.metadata?.artist ?? "",
    thumbnailUrl: item.metadata?.thumbnailUrl
  };
  await triggerDownload({
    data: outputBytes,
    filenameOutput: `${filenameBase}.${targetExt}`,
    recentContext
  });
  await reportProgress({
    videoId,
    progress: 1,
    progressType: ProgressType.FFmpeg,
    tabId
  });
}

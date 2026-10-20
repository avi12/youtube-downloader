import { fetchChapters, fetchPlaylist } from "@/lib/page";
import type { PlaylistEntry } from "@/lib/page";
import { BotCheckError, parsePlaylistId, parseVideoId, registerRequestHeaderRules, resolveVideo, resolveVideoFromPage } from "@/lib/youtube";
import type { Chapter } from "./fields";
import { parseYtDlpCommand } from "./options";
import type { YtDlpOptions } from "./options";
import { planVideo } from "./plan";
import type { DirectFile, Job } from "./plan";
import { selectPlaylistIndices, shuffle } from "./playlist-items";
import { buildVideoFields } from "./fields";
import { renderTemplate } from "./template";

export type SessionHooks = {
  signal: AbortSignal;
  log: (text: string) => void;
  status: (text: string) => void;
  runJob: (job: Job) => Promise<void>;
  saveDirectFile: (file: DirectFile) => Promise<void>;
};

export type TabContext = { tabId?: number; url?: string };

type Target = { videoId: string; title: string; index: number; count: number; playlistId?: string; playlistTitle?: string };
type SessionScope = { options: YtDlpOptions; tab: TabContext };
type UrlExpansion = SessionScope & { url: string };
type ChapterLookup = SessionScope & { videoId: string; durationSeconds: number };
type TargetRun = SessionScope & { target: Target; autonumber: number; hooks: SessionHooks };
type FlatPrint = { options: YtDlpOptions; targets: Target[]; hooks: SessionHooks };
export type YtDlpRun = { command: string; tab: TabContext; hooks: SessionHooks };

const FLAT_PLAYLIST_DEFAULT_PRINT = "%(id)s\t%(title)s";
const CHAPTER_FIELD_PATTERN = /chapter|section/;

function needsChapters(options: YtDlpOptions) {
  const usesChapterPattern = options.sections.some(section => section.chapterPattern);
  const printsChapters = options.prints.some(template => CHAPTER_FIELD_PATTERN.test(template));
  return options.isEmbedChapters || options.isSplitChapters || usesChapterPattern || printsChapters;
}

function needsCaptions(options: YtDlpOptions) {
  return options.isWriteSubs || options.isWriteAutoSubs || options.isEmbedSubs || options.isListSubs;
}

async function expandUrl({ url, options, tab }: UrlExpansion): Promise<Target[]> {
  const videoId = parseVideoId(url);
  const playlistId = parsePlaylistId(url);
  const isPlaylistWanted = Boolean(playlistId) && !(videoId && options.isNoPlaylist);
  if (!isPlaylistWanted) {
    if (!videoId) {
      throw new Error(`Not a YouTube video or playlist URL: ${url}`);
    }

    return [{ videoId, title: videoId, index: 1, count: 1 }];
  }

  const playlist = await fetchPlaylist({ tabId: tab.tabId, playlistId: playlistId! });
  const indices = selectPlaylistIndices(playlist.entries.length, options.playlistItems, options.playlistStart, options.playlistEnd);
  const ordered = options.isPlaylistReverse ? indices.toReversed() : indices;
  const finalOrder = options.isPlaylistRandom ? shuffle(ordered) : ordered;
  return finalOrder.map(index => {
    const entry: PlaylistEntry = playlist.entries[index - 1]!;
    return { videoId: entry.videoId, title: entry.title, index, count: playlist.entries.length, playlistId: playlistId!, playlistTitle: playlist.title };
  });
}

async function resolveChapters({ options, tab, videoId, durationSeconds }: ChapterLookup): Promise<Chapter[]> {
  if (!needsChapters(options)) {
    return [];
  }

  const raw = await fetchChapters({ tabId: tab.tabId, videoId });
  return raw.map((chapter, index) => ({ title: chapter.title, start: chapter.start, end: raw[index + 1]?.start ?? durationSeconds }));
}

async function processTarget({ options, tab, target, autonumber, hooks }: TargetRun) {
  hooks.status(`Looking up ${target.title}`);
  const video = await resolveVideo(target.videoId).catch((error: unknown) => {
    const isOnThisVideo = Boolean(tab.url) && parseVideoId(tab.url!) === target.videoId;
    if (!(error instanceof BotCheckError) || !isOnThisVideo) {
      throw error;
    }

    hooks.log("YouTube's bot check blocked the direct lookup, reading the open tab's player instead");
    return resolveVideoFromPage({ tabId: tab.tabId, videoId: target.videoId, withCaptions: needsCaptions(options) });
  });
  const chapters = await resolveChapters({ options, tab, videoId: target.videoId, durationSeconds: video.durationSeconds });
  const playlist = target.playlistId ? { id: target.playlistId, title: target.playlistTitle ?? "", index: target.index, count: target.count } : undefined;
  const plan = planVideo(options, { video, chapters, playlist, autonumber });
  for (const line of plan.printed) {
    hooks.log(line);
  }

  if (plan.skipReason) {
    hooks.log(`Skipped: ${plan.skipReason}`);
    return { isDownloaded: false, isBreak: Boolean(plan.isBreak) };
  }

  for (const job of plan.jobs) {
    hooks.signal.throwIfAborted();
    await hooks.runJob(job);
  }

  for (const file of plan.directFiles) {
    hooks.signal.throwIfAborted();
    await hooks.saveDirectFile(file);
  }

  return { isDownloaded: plan.jobs.length + plan.directFiles.length > 0, isBreak: false };
}

function printFlatEntries({ options, targets, hooks }: FlatPrint) {
  const templates = options.prints.length ? options.prints : [FLAT_PLAYLIST_DEFAULT_PRINT];
  for (const target of targets) {
    const fields = {
      ...buildVideoFields({ id: target.videoId, title: target.title, uploader: "", channelId: "", description: "", durationSeconds: 0, viewCount: 0, tags: [], category: "", isLive: false, uploadDate: "", thumbnails: [], formats: [], captions: [] }),
      url: `https://www.youtube.com/watch?v=${target.videoId}`
    };
    for (const template of templates) {
      hooks.log(renderTemplate(template, fields));
    }
  }
}

export async function runYtDlpCommand({ command, tab, hooks }: YtDlpRun) {
  const options = parseYtDlpCommand(command);
  if (options.ignoredFlags.length) {
    hooks.log(`Ignored, no effect in a browser: ${[...new Set(options.ignoredFlags)].join(" ")}`);
  }

  const urls = options.urls.length ? options.urls : [tab.url ?? ""];
  await registerRequestHeaderRules();
  const targets = (await Promise.all(urls.map(url => expandUrl({ url, options, tab })))).flat();
  if (options.isFlatPlaylist) {
    printFlatEntries({ options, targets, hooks });
    return;
  }

  const isAbortOnError = options.isAbortOnError || targets.length === 1;
  let downloadCount = 0;
  for (const [index, target] of targets.entries()) {
    hooks.signal.throwIfAborted();
    if (options.maxDownloads !== undefined && downloadCount >= options.maxDownloads) {
      hooks.log(`Stopped after --max-downloads ${options.maxDownloads}`);
      return;
    }

    const outcome = await processTarget({ options, tab, target, autonumber: index + 1, hooks }).catch((error: unknown) => {
      if (isAbortOnError || hooks.signal.aborted) {
        throw error;
      }

      hooks.log(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
      return { isDownloaded: false, isBreak: false };
    });
    downloadCount += Number(outcome.isDownloaded);
    if (outcome.isBreak) {
      return;
    }
  }
}

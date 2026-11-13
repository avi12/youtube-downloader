import type { PageTask } from "@/lib/page-events";
import type { PageResult } from "@/lib/schemas";

export type PlaylistListing = NonNullable<PageResult["playlist"]>;
export type PlaylistEntry = PlaylistListing["entries"][number];
export type RawChapter = NonNullable<PageResult["chapters"]>[number];
export async function runInsideYouTubePage(task: PageTask) {
  const maxPages = 200;
  const millisecondsPerSecond = 1000;
  const sapisidPattern = /(?:^|; )(?:__Secure-3PAPISID|SAPISID)=([^;]+)/;
  const byteRadix = 16;
  const byteWidth = 2;
  interface CapturedRequest {
    url: string;
    body: string;
  }
  type YouTubeWindow = Window & {
    ytcfg?: { get: (key: string) => unknown };
    __ffmpegLiteRequests?: CapturedRequest[];
    __ffmpegLiteTimedText?: string[];
  };
  const youtubeWindow: YouTubeWindow = window;
  const ytcfg = youtubeWindow.ytcfg;
  const context = ytcfg?.get("INNERTUBE_CONTEXT");

  interface PlayerCapture {
    videoId: string;
    isCaptionsWanted: boolean;
  }

  interface ParamCopy {
    target: URLSearchParams;
    source: URLSearchParams;
  }

  function copyMissingParams({ target, source }: ParamCopy) {
    for (const [param, value] of source) {
      if (!target.has(param)) {
        target.set(param, value);
      }
    }
  }

  async function capturePlayer({ videoId, isCaptionsWanted }: PlayerCapture) {
    const timedtextPath = "/api/timedtext";
    const captionWaitMs = 5000;
    const maxCaptured = 8;
    const seekWaitMs = 3000;
    const qualityWaitMs = 8000;
    const pollMs = 200;
    const seekFraction = 4;
    const segmentPath = "googlevideo.com/videoplayback";
    const playerElement = document.querySelector<HTMLElement & Record<string, unknown>>("#movie_player");

    interface PlayerCall {
      method: string;
      args?: unknown[];
    }

    function callPlayer({ method, args = [] }: PlayerCall) {
      const member = playerElement?.[method];
      return typeof member === "function" ? member.apply(playerElement, args) : undefined;
    }

    const playerResponse = callPlayer({ method: "getPlayerResponse" });
    const currentVideoId = child({
      node: playerResponse,
      path: ["videoDetails", "videoId"]
    });
    const isDifferentVideo = currentVideoId !== videoId;
    if (isDifferentVideo) {
      return { error: "Open this video's watch page first" };
    }

    function toBase64(buffer: ArrayBuffer) {
      return btoa(String.fromCharCode(...new Uint8Array(buffer)));
    }

    const isHookInstalled = Boolean(youtubeWindow.__ffmpegLiteRequests);
    const captured = youtubeWindow.__ffmpegLiteRequests ?? [];
    const timedTextUrls = youtubeWindow.__ffmpegLiteTimedText ?? [];
    if (!isHookInstalled) {
      youtubeWindow.__ffmpegLiteRequests = captured;
      youtubeWindow.__ffmpegLiteTimedText = timedTextUrls;
      const originalOpen = XMLHttpRequest.prototype.open;
      Object.defineProperty(XMLHttpRequest.prototype, "open", {
        value(this: XMLHttpRequest, ...args: Parameters<typeof originalOpen>) {
          const url = String(args[1]);
          if (url.includes(timedtextPath)) {
            timedTextUrls.push(url);
          }

          return originalOpen.apply(this, args);
        }
      });
      const originalFetch = window.fetch;
      window.fetch = function (...args: Parameters<typeof fetch>) {
        const [input, init] = args;
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes(timedtextPath)) {
          timedTextUrls.push(url);
        }

        function record(buffer: ArrayBuffer) {
          captured.push({
            url,
            body: toBase64(buffer)
          });
        }

        const isSegmentUrl = url.includes(segmentPath);
        if (isSegmentUrl) {
          if (init?.body instanceof ArrayBuffer) {
            record(init.body);
          } else if (init?.body && ArrayBuffer.isView(init.body)) {
            record(init.body.buffer.slice(init.body.byteOffset, init.body.byteOffset + init.body.byteLength));
          } else if (input instanceof Request) {
            input.clone().arrayBuffer().then(record).catch(() => undefined);
          }
        }

        return originalFetch.apply(window, args);
      };
    }

    const time = Number(
      callPlayer({
        method: "getCurrentTime"
      })
    ) || 0;
    const duration = Number(
      callPlayer({
        method: "getDuration"
      })
    ) || 0;
    const capturedBefore = captured.length;

    async function waitForNewRequest(timeoutMs: number) {
      for (let waited = 0; waited < timeoutMs && captured.length === capturedBefore; waited += pollMs) {
        await new Promise(resolve => setTimeout(resolve, pollMs));
      }
    }

    const isInFirstHalf = time < duration / 2;
    const seekTarget = isInFirstHalf ? time + duration / seekFraction : Math.max(0, time - duration / seekFraction);
    callPlayer({
      method: "seekTo",
      args: [seekTarget, true]
    });
    await waitForNewRequest(seekWaitMs);

    if (captured.length === capturedBefore) {
      const levels = callPlayer({ method: "getAvailableQualityLevels" });
      const currentQuality = callPlayer({ method: "getPlaybackQuality" });
      const otherQuality = Array.isArray(levels) ? levels.find(level => level !== currentQuality && level !== "auto") : undefined;
      callPlayer({
        method: "setPlaybackQualityRange",
        args: [otherQuality, otherQuality]
      });
      await waitForNewRequest(qualityWaitMs);
      callPlayer({
        method: "setPlaybackQualityRange",
        args: [currentQuality, currentQuality]
      });
    }

    callPlayer({
      method: "seekTo",
      args: [time, true]
    });

    const trackListValue = child({
      node: playerResponse,
      path: ["captions", "playerCaptionsTracklistRenderer", "captionTracks"]
    });
    const hasTrackList = isCaptionsWanted && Array.isArray(trackListValue);
    const trackList: unknown[] = hasTrackList ? trackListValue : [];
    const captionTexts: Record<string, string> = {};
    if (trackList.length) {
      const timedTextBefore = timedTextUrls.length;
      callPlayer({
        method: "loadModule",
        args: ["captions"]
      });
      callPlayer({ method: "toggleSubtitlesOn" });
      for (let waited = 0; waited < captionWaitMs && timedTextUrls.length === timedTextBefore; waited += pollMs) {
        await new Promise(resolve => setTimeout(resolve, pollMs));
      }

      const sampleUrl = timedTextUrls.length > timedTextBefore ? timedTextUrls.at(-1) : undefined;
      const tokens = sampleUrl ? new URL(sampleUrl, location.href).searchParams : new URLSearchParams();
      for (const track of trackList) {
        const baseUrl = child({
          node: track,
          path: ["baseUrl"]
        });
        if (typeof baseUrl === "string") {
          const captionUrl = new URL(baseUrl);
          copyMissingParams({
             target: captionUrl.searchParams,
             source: tokens 
          });

          captionUrl.searchParams.set("fmt", "vtt");
          captionTexts[baseUrl] = await fetch(captionUrl.href, { credentials: "include" }).then(response => response.text()).catch(() => "");
        }
      }

      callPlayer({ method: "toggleSubtitles" });
    }

    return {
      player: {
        playerResponse,
        requests: captured.slice(-maxCaptured),
        captionTexts
      }
    };
  }

  if (task.kind === "time") {
    const player = document.querySelector<HTMLElement & { getCurrentTime?: () => number }>("#movie_player");
    const currentTime = player?.getCurrentTime?.();
    return typeof currentTime === "number" ? { currentTime } : { error: "There's no YouTube video playing in this tab" };
  }

  if (task.kind === "player") {
    return capturePlayer({
      videoId: task.id,
      isCaptionsWanted: Boolean(task.withCaptions)
    });
  }

  if (!context) {
    return { error: "Open a YouTube page first" };
  }

  async function buildHeaders() {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Youtube-Client-Name": String(ytcfg?.get("INNERTUBE_CONTEXT_CLIENT_NAME")),
      "X-Youtube-Client-Version": String(ytcfg?.get("INNERTUBE_CONTEXT_CLIENT_VERSION"))
    };
    const sapisid = document.cookie.match(sapisidPattern)?.[1];
    if (!sapisid) {
      return headers;
    }

    const timestamp = Math.floor(Date.now() / millisecondsPerSecond);
    const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`${timestamp} ${sapisid} ${location.origin}`));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(byteRadix).padStart(byteWidth, "0")).join("");
    return {
      ...headers,
      Authorization: `SAPISIDHASH ${timestamp}_${hash}`,
      "X-Origin": location.origin,
      "X-Goog-AuthUser": "0"
    };
  }

  interface PostRequest {
    endpoint: string;
    body: object;
  }

  async function post({ endpoint, body }: PostRequest) {
    const response = await fetch(`/youtubei/v1/${endpoint}?prettyPrint=false`, {
      method: "POST",
      credentials: "include",
      headers: await buildHeaders(),
      body: JSON.stringify({
        context,
        ...body
      })
    });
    if (!response.ok) {
      throw new Error(`YouTube answered ${response.status}`);
    }

    return response.json();
  }

  type JsonRecord = Record<string, unknown>;

  function isRecord(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function* walk(root: unknown) {
    const pending = [root];
    while (pending.length) {
      const node = pending.pop();
      if (typeof node !== "object" || node === null) {
        continue;
      }

      if (isRecord(node)) {
        yield node;
      }

      pending.push(...Object.values(node).reverse());
    }
  }

  interface NodePath {
    node: unknown;
    path: string[];
  }

  function child({ node, path }: NodePath) {
    let current = node;
    for (const key of path) {
      current = isRecord(current) ? current[key] : undefined;
    }

    return current;
  }

  function readText(value: unknown) {
    if (typeof value === "string") {
      return value;
    }

    const simpleText = child({
      node: value,
      path: ["simpleText"]
    });
    const content = child({
      node: value,
      path: ["content"]
    });
    const runs = child({
      node: value,
      path: ["runs"]
    });
    if (typeof simpleText === "string") {
      return simpleText;
    }

    if (typeof content === "string") {
      return content;
    }

    return Array.isArray(runs) ? runs.map(run => String(
      child({
        node: run,
        path: ["text"]
      }) ?? ""
    )).join("") : "";
  }

  async function listPlaylist(listId: string) {
    const entries: PlaylistEntry[] = [];
    const seen = new Set<string>();
    let playlistTitle = "";
    let response = await post({
      endpoint: "browse",
      body: {
        browseId: `VL${listId}`
      }
    });
    for (let page = 0; page < maxPages; page++) {
      playlistTitle ||= readText(
        child({
          node: response,
          path: ["metadata", "playlistMetadataRenderer", "title"]
        })
      );
      let token = "";
      for (const node of walk(response)) {
        const renderer = child({
          node,
          path: ["playlistVideoRenderer"]
        });
        const isLockupVideo = node.contentType === "LOCKUP_CONTENT_TYPE_VIDEO";
        const videoId = child({
          node: renderer,
          path: ["videoId"]
        }) ?? (isLockupVideo ? node.contentId : undefined);
        const isNewVideoId = typeof videoId === "string" && !seen.has(videoId);
        if (isNewVideoId) {
          seen.add(videoId);
          const lockupTitle = child({
            node,
            path: ["metadata", "lockupMetadataViewModel"]
          });
          entries.push({
            videoId,
            title: readText(
              child({
                node: renderer,
                path: ["title"]
              }) ?? child({
                node: lockupTitle,
                path: ["title"]
              })
            )
          });
        }

        const continuationToken = child({
          node,
          path: ["continuationCommand", "token"]
        });
        token ||= typeof continuationToken === "string" ? continuationToken : "";
      }

      if (!token) {
        break;
      }

      response = await post({
        endpoint: "browse",
        body: {
          continuation: token
        }
      });
    }

    return {
      title: playlistTitle,
      entries
    };
  }

  async function listChapters(videoId: string) {
    const response = await post({
      endpoint: "next",
      body: {
        videoId
      }
    });
    const chapters = new Map<number, string>();
    for (const node of walk(response)) {
      const renderer = child({
        node,
        path: ["chapterRenderer"]
      });
      const startMillis = child({
        node: renderer,
        path: ["timeRangeStartMillis"]
      });
      if (typeof startMillis === "number") {
        chapters.set(
          startMillis / millisecondsPerSecond, readText(
            child({
              node: renderer,
              path: ["title"]
            })
          )
        );
      }

      const marker = child({
        node,
        path: ["macroMarkersListItemRenderer"]
      });
      const startSeconds = child({
        node: marker,
        path: ["onTap", "watchEndpoint", "startTimeSeconds"]
      });
      if (typeof startSeconds === "number") {
        chapters.set(
          startSeconds, readText(
            child({
              node: marker,
              path: ["title"]
            })
          )
        );
      }
    }

    return [...chapters].sort(([first], [second]) => first - second).map(([start, title]) => ({
      title,
      start
    }));
  }

  try {
    if (task.kind === "playlist") {
      return { playlist: await listPlaylist(task.id) };
    }

    return { chapters: await listChapters(task.id) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

import { MessageType, onMessage, sendMessage } from "../lib/messaging";
import {
  clearCapturedSabrData,
  extractPoTokenFromBody,
  getCapturedSabrData,
  onSabrBodyCaptured,
  startSabrRequestCapture
} from "../lib/sabr-request-capture";
import { clearLocalStorage, interruptedDownloadsItem, isFFmpegReadyItem, statusProgressItem } from "../lib/storage";
import { ProgressType } from "../types";

async function fetchPlayerResponse(videoId: string, cookieString: string) {
  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { cookie: cookieString }
  });
  const html = await response.text();

  const marker = "var ytInitialPlayerResponse = ";
  const iStart = html.indexOf(marker);
  if (iStart === -1) {
    throw new Error(`Could not find ytInitialPlayerResponse (html length: ${html.length}, has consent: ${html.includes("consent")}, status: ${response.status})`);
  }

  const iJsonStart = iStart + marker.length;
  let depth = 0;
  let iEnd = iJsonStart;
  for (let iChar = iJsonStart; iChar < html.length; iChar++) {
    if (html[iChar] === "{") {
      depth++;
    } else if (html[iChar] === "}") {
      depth--;

      if (depth === 0) {
        iEnd = iChar + 1;
        break;
      }
    }
  }

  return JSON.parse(html.slice(iJsonStart, iEnd));
}

const NATIVE_HOST_NAME = "com.avi12.youtube_downloader";

export default defineBackground(() => {
  // ─── Native messaging for googlevideo requests ─────────────────────────
  // Chrome forces `Origin: chrome-extension://` on all extension requests,
  // which googlevideo rejects. The native host makes requests directly
  // with `Origin: https://www.youtube.com`.

  let nativePort: Browser.runtime.Port | null = null;

  function getNativePort() {
    if (nativePort) {
      return nativePort;
    }

    nativePort = browser.runtime.connectNative(NATIVE_HOST_NAME);
    nativePort.onDisconnect.addListener(() => {
      const error = browser.runtime.lastError;
      if (error) {
        console.warn("[ytdl:bg] Native host disconnected:", error.message);
      }

      nativePort = null;
    });

    return nativePort;
  }

  interface NativeResponse {
    requestId: string;
    type: string;
    status: number;
    bodyBase64: string;
    // Chunked response fields
    iChunk?: number;
    totalChunks?: number;
    chunkBase64?: string;
    // Error
    error?: string;
  }

  async function nativeFetch(request: {
    requestId: string;
    url: string;
    bodyBase64: string;
    cookies: string;
  }) {
    const port = getNativePort();

    return new Promise<{ status: number; bodyBase64: string } | null>(resolve => {
      const chunks = new Map<number, string>();
      let expectedChunks = 0;

      function handleMessage(response: NativeResponse) {
        if (response.requestId !== request.requestId) {
          return;
        }

        if (response.type === "error") {
          port.onMessage.removeListener(handleMessage);
          resolve(null);
          return;
        }

        if (response.type === "response") {
          port.onMessage.removeListener(handleMessage);
          resolve({ status: response.status, bodyBase64: response.bodyBase64 });
          return;
        }

        if (response.type === "chunk") {
          expectedChunks = response.totalChunks ?? 0;
          chunks.set(response.iChunk ?? 0, response.chunkBase64 ?? "");

          if (chunks.size >= expectedChunks) {
            port.onMessage.removeListener(handleMessage);
            let fullBase64 = "";
            for (let i = 0; i < expectedChunks; i++) {
              fullBase64 += chunks.get(i) ?? "";
            }
            resolve({ status: response.status, bodyBase64: fullBase64 });
          }
        }
      }

      port.onMessage.addListener(handleMessage);
      port.postMessage({
        requestId: request.requestId,
        type: "fetch",
        url: request.url,
        bodyBase64: request.bodyBase64,
        cookies: request.cookies,
        method: "POST",
        headers: {
          "Content-Type": "application/x-protobuf"
        }
      });

      // Timeout after 60s
      setTimeout(() => {
        port.onMessage.removeListener(handleMessage);
        resolve(null);
      }, 60_000);
    });
  }

  // Content scripts are declared statically via defineContentScript in each
  // entrypoint file. WXT generates the manifest content_scripts entries.

  // Rewrite Origin header on googlevideo requests from the extension.
  // Chrome strips Origin/Cookie from service worker fetch even with host_permissions.
  // Use declarativeNetRequest to inject the required headers.
  // declarativeNetRequest is available on Chrome and Firefox MV3 but
  // missing from WXT's type definitions. Access via bracket notation.
  const declarativeNetRequest = browser["declarativeNetRequest"];
  // Cookie string for googlevideo requests.
  // chrome.cookies.getAll() returns empty in copied profiles (DPAPI encryption),
  // so we build the string from individual cookie.get() calls instead.
  let cachedYoutubeCookies = "";

  const YOUTUBE_COOKIE_NAMES = [
    "SID", "HSID", "SSID", "APISID", "SAPISID", "LOGIN_INFO", "PREF",
    "__Secure-1PSID", "__Secure-3PSID", "__Secure-1PAPISID", "__Secure-3PAPISID",
    "__Secure-1PSIDTS", "__Secure-3PSIDTS", "NID", "SIDCC",
    "__Secure-1PSIDCC", "__Secure-3PSIDCC"
  ];

  async function buildYoutubeCookieString() {
    const parts: string[] = [];
    for (const name of YOUTUBE_COOKIE_NAMES) {
      const cookie = await browser.cookies.get({ url: "https://www.youtube.com", name });
      if (cookie) {
        parts.push(`${cookie.name}=${cookie.value}`);
      }
    }
    return parts.join("; ");
  }

  async function updateGooglevideoHeaderRules(cookieString?: string) {
    if (!declarativeNetRequest) {
      console.log("[ytdl:bg] DNR not available");
      return;
    }

    if (cookieString) {
      cachedYoutubeCookies = cookieString;
    }

    const cookieHeaders = cachedYoutubeCookies
      ? [{ header: "Cookie", operation: "set", value: cachedYoutubeCookies }]
      : [];

    await declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1],
      addRules: [
        {
          id: 1,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              { header: "Origin", operation: "set", value: "https://www.youtube.com" },
              { header: "Sec-Fetch-Site", operation: "set", value: "cross-site" },
              { header: "Sec-Fetch-Mode", operation: "set", value: "cors" },
              ...cookieHeaders
            ]
          },
          condition: {
            urlFilter: "*googlevideo.com*"
          }
        }
      ]
    });
  }
  void (async () => {
    const cookies = await buildYoutubeCookieString();
    await updateGooglevideoHeaderRules(cookies);
  })();

  startSabrRequestCapture();
  onSabrBodyCaptured(tabId => {
    // Content script might not be ready yet during initial page load.
    // Send notification and silently ignore connection errors.
    void sendMessage(MessageType.SabrBodyReady, {}, tabId);
  });

  // - Tab tracking -

  const videoIdToTabIds: Record<string, number[]> = {};
  const tabTracker: Record<number, { videoIdsAvailable: string[] }> = {};

  function trackVideoForTab(videoId: string, tabId: number) {
    if (!videoIdToTabIds[videoId]) {
      videoIdToTabIds[videoId] = [tabId];
    } else if (!videoIdToTabIds[videoId].includes(tabId)) {
      videoIdToTabIds[videoId].push(tabId);
    }
  }

  function untrackVideoForTab(videoId: string, tabId: number) {
    if (!videoIdToTabIds[videoId]) {
      return;
    }

    videoIdToTabIds[videoId] = videoIdToTabIds[videoId].filter(id => {
      return id !== tabId;
    });
  }

  // - FFmpeg processor management -
  // Chrome: offscreen document (persistent, not killed by SW lifecycle)
  // Firefox: background tab with offscreen.html (no offscreen API available)

  let processorReady: Promise<void> | null = null;
  let firefoxProcessorTabId: number | null = null;

  function ensureProcessor() {
    if (processorReady) {
      return processorReady;
    }

    processorReady = import.meta.env.FIREFOX
      ? ensureFirefoxProcessorTab()
      : ensureChromeOffscreenDocument();

    return processorReady;
  }

  async function ensureChromeOffscreenDocument() {
    let existingContexts: Browser.runtime.ExtensionContext[] = [];
    try {
      const contextTypes = [browser.runtime.ContextType.OFFSCREEN_DOCUMENT];
      existingContexts = await browser.runtime.getContexts({ contextTypes });
    } catch {
      // getContexts not available in all environments
    }

    if (existingContexts.length > 0) {
      return;
    }

    await browser.offscreen.createDocument({
      url: "/offscreen.html",
      reasons: [browser.offscreen.Reason.WORKERS],
      justification: "FFmpeg WASM processing requires a Worker context"
    });
  }

  async function ensureFirefoxProcessorTab() {
    // Check if existing tab is still alive
    if (firefoxProcessorTabId !== null) {
      try {
        await browser.tabs.get(firefoxProcessorTabId);
        return;
      } catch {
        firefoxProcessorTabId = null;
      }
    }

    const tab = await browser.tabs.create({
      url: browser.runtime.getURL("/offscreen.html"),
      active: false
    });

    firefoxProcessorTabId = tab.id ?? null;
  }

  void ensureProcessor();

  // - Chunk forwarding to processor -

  onMessage(MessageType.StreamChunk, async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      console.warn("[ytdl:bg] streamChunk: no tabId");
      return;
    }

    await ensureProcessor();
    await sendMessage(MessageType.ProcessStreamChunk, {
      ...data,
      tabId
    });
  });

  onMessage(MessageType.StreamEnd, async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return;
    }

    trackVideoForTab(data.videoId, tabId);

    tabTracker[tabId] ??= { videoIdsAvailable: [] };

    if (!tabTracker[tabId].videoIdsAvailable.includes(data.videoId)) {
      tabTracker[tabId].videoIdsAvailable.push(data.videoId);
    }

    await ensureProcessor();
    await sendMessage(MessageType.ProcessStreamEnd, {
      ...data,
      tabId
    });
  });

  async function cancelDownloads(videoIds: string[]) {
    await sendMessage(MessageType.CancelProcessing, { videoIds });
  }

  // - Message handlers -

  // ProxyFetch: update DNR cookies, then relay to offscreen doc via Port.
  // @webext-core/messaging's sendMessage doesn't reach offscreen docs,
  // so we use chrome.runtime.connect for a direct port connection.
  let offscreenPort: Browser.runtime.Port | null = null;

  function getOffscreenPort() {
    if (offscreenPort) {
      return offscreenPort;
    }

    // The offscreen doc listens for connections named "ytdl-proxy-fetch"
    offscreenPort = browser.runtime.connect({ name: "ytdl-proxy-fetch" });
    offscreenPort.onDisconnect.addListener(() => {
      offscreenPort = null;
    });
    return offscreenPort;
  }

  onMessage(MessageType.ProxyFetch, async ({ data }) => {
    const pageCookies = "cookies" in data ? String(data.cookies ?? "") : "";
    const fetchUrl = "url" in data ? String(data.url) : "";
    const bodyBase64 = "bodyBase64" in data ? String(data.bodyBase64) : "";
    if (pageCookies) {
      await updateGooglevideoHeaderRules(pageCookies);
    }

    if (!fetchUrl) {
      return null;
    }

    await ensureProcessor();

    // Relay through offscreen doc via Port (DNR applies to background_page)
    return new Promise<{ status: number; bodyBase64: string } | null>(resolve => {
      console.log("[ytdl:bg] ProxyFetch relaying via Port");
      const port = getOffscreenPort();
      const requestId = Math.random().toString(36).slice(2);

      function onResponse(message: { requestId: string; result: { status: number; bodyBase64: string } | null }) {
        if (message.requestId !== requestId) {
          return;
        }

        port.onMessage.removeListener(onResponse);
        resolve(message.result);
      }

      port.onMessage.addListener(onResponse);
      port.postMessage({ requestId, url: fetchUrl, bodyBase64 });

      // Timeout after 60s
      setTimeout(() => {
        port.onMessage.removeListener(onResponse);
        resolve(null);
      }, 60_000);
    });
  });

  onMessage(MessageType.ResolveFormatUrls, async ({ data }) => {
    const { videoId, videoItag, audioItag } = data;

    try {
      const cookies = cachedYoutubeCookies || await buildYoutubeCookieString();
      const playerResponse = await fetchPlayerResponse(videoId, cookies);
      if (playerResponse.playabilityStatus?.status !== "OK") {
        return null;
      }

      const formats = playerResponse.streamingData?.adaptiveFormats ?? [];
      const videoFormat = formats.find((format: { itag: number }) => {
        return format.itag === videoItag;
      });
      const audioFormat = formats.find((format: { itag: number }) => {
        return format.itag === audioItag;
      });

      return {
        videoUrl: videoFormat?.url ?? null,
        audioUrl: audioFormat?.url ?? null,
        videoMimeType: videoFormat?.mimeType?.split(";")?.[0] ?? "video/mp4",
        audioMimeType: audioFormat?.mimeType?.split(";")?.[0] ?? "audio/mp4"
      };
    } catch {
      return null;
    }
  });

  onMessage(MessageType.GetCapturedSabrBody, async ({ sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return null;
    }

    const captured = getCapturedSabrData(tabId);
    if (!captured) {
      return null;
    }

    const poToken = extractPoTokenFromBody(captured.body) ?? "";

    return {
      body: btoa(String.fromCharCode(...captured.body)),
      url: captured.url,
      poToken
    };
  });

  onMessage(MessageType.SabrDownload, async ({ data, sender }) => {
    const { request, poToken, cookies } = data;
    const tabId = sender.tab?.id ?? 0;
    if (!request.sabrConfig) {
      return false;
    }

    // Update DNR rules with cookies + Origin for googlevideo requests.
    // The offscreen XHR proxy needs DNR to inject proper headers.
    if (cookies) {
      await updateGooglevideoHeaderRules(cookies);
    } else if (!cachedYoutubeCookies) {
      const builtCookies = await buildYoutubeCookieString();
      await updateGooglevideoHeaderRules(builtCookies);
    }

    await ensureProcessor();

    try {
      const { SabrStream } = await import("googlevideo/sabr-stream");
      const { buildSabrFormat } = await import("googlevideo/utils");

      const sabrConfig = request.sabrConfig;
      const sabrFormats = sabrConfig.formats.map(format => {
        return buildSabrFormat({
          itag: format.itag,
          lastModified: String(format.lastModified),
          xtags: format.xtags,
          width: format.width,
          height: format.height,
          mimeType: format.mimeType,
          audioQuality: format.audioQuality,
          bitrate: format.bitrate,
          averageBitrate: format.averageBitrate,
          quality: format.quality,
          qualityLabel: format.qualityLabel ?? undefined,
          audioTrackId: format.audioTrack?.id,
          approxDurationMs: format.approxDurationMs,
          contentLength: format.contentLength,
          isDrc: false
        });
      });

      const durationMs = parseInt(sabrConfig.formats[0]?.approxDurationMs ?? "0");
      const videoFormat = sabrFormats.find(format => {
        return format.itag === request.videoItag;
      });
      const audioFormat = sabrFormats.find(format => {
        return format.itag === request.audioItag;
      });
      if (!videoFormat || !audioFormat) {
        return false;
      }

      // Fetch wrapper for SabrStream. Routes through the native messaging host
      // which makes HTTP requests directly with proper Origin/Cookie headers.
      // Chrome strips Origin from all extension-initiated requests, so the host
      // process is the only way to send `Origin: https://www.youtube.com`.
      async function sabrFetch(input: RequestInfo | URL, init?: RequestInit) {
        const url = input instanceof URL ? input.href : String(input);
        let bodyBytes: Uint8Array;
        if (init?.body instanceof Uint8Array) {
          bodyBytes = init.body;
        } else if (init?.body) {
          bodyBytes = new Uint8Array(await new Response(init.body).arrayBuffer());
        } else {
          bodyBytes = new Uint8Array(0);
        }

        const batchSize = 8192;
        let bodyBase64 = "";
        for (let offset = 0; offset < bodyBytes.byteLength; offset += batchSize) {
          bodyBase64 += String.fromCharCode(
            ...bodyBytes.subarray(offset, Math.min(offset + batchSize, bodyBytes.byteLength))
          );
        }
        bodyBase64 = btoa(bodyBase64);

        const requestId = `sabr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const nativeResponse = await nativeFetch({
          requestId,
          url,
          bodyBase64,
          cookies: cachedYoutubeCookies
        });
        if (!nativeResponse) {
          throw new TypeError("Native messaging host returned no response");
        }

        const responseBytes = Uint8Array.from(atob(nativeResponse.bodyBase64), character => {
          return character.charCodeAt(0);
        });

        return new Response(responseBytes, {
          status: nativeResponse.status,
          headers: { "content-type": "application/vnd.yt-ump" }
        });
      }

      const sabrStream = new SabrStream({
        fetch: sabrFetch,
        serverAbrStreamingUrl: sabrConfig.serverAbrStreamingUrl,
        videoPlaybackUstreamerConfig: sabrConfig.videoPlaybackUstreamerConfig,
        poToken: poToken || undefined,
        clientInfo: {
          clientName: sabrConfig.clientName,
          clientVersion: sabrConfig.clientVersion
        },
        formats: sabrFormats,
        durationMs
      });

      // Refresh PO token when YouTube's SPS escalates
      const sabrEmitter: { on(event: string, listener: (...args: unknown[]) => void): void } = sabrStream;
      sabrEmitter.on("streamProtectionStatusUpdate", async (sps: unknown) => {
        const spsData = sps && typeof sps === "object" && "status" in sps ? sps : { status: 0 };
        const { status } = spsData;
        if (typeof status === "number" && status >= 2) {
          try {
            const freshToken = await sendMessage(MessageType.RefreshPoToken, { videoId: request.videoId }, tabId);
            if (freshToken) {
              sabrStream.setPoToken(freshToken);
            }
          } catch {
            // Token refresh failed - SabrStream will throw on status 3
          }
        }
      });

      await ensureProcessor();

      const { videoStream, audioStream } = await sabrStream.start({
        videoFormat,
        audioFormat
      });

      const videoMimeType = sabrConfig.formats.find(
        format => {
          return format.itag === request.videoItag;
        }
      )?.mimeType.split(";")[0] ?? "video/mp4";

      const audioMimeType = sabrConfig.formats.find(
        format => {
          return format.itag === request.audioItag;
        }
      )?.mimeType.split(";")[0] ?? "audio/mp4";

      // Stream chunks to the processor AS they arrive instead of buffering
      // the entire video in SW memory (which causes Chrome to kill the SW).
      const chunkSize = 1024 * 1024;

      async function streamToProcessor(
        stream: ReadableStream<Uint8Array>,
        streamType: string
      ) {
        const reader = stream.getReader();
        let buffer = new Uint8Array(0);
        let iChunk = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (value) {
            // Append to buffer
            const newBuffer = new Uint8Array(buffer.byteLength + value.byteLength);
            newBuffer.set(buffer);
            newBuffer.set(value, buffer.byteLength);
            buffer = newBuffer;
          }

          // Send complete chunks (1MB each) as they accumulate
          while (buffer.byteLength >= chunkSize || (done && buffer.byteLength > 0)) {
            const slice = buffer.slice(0, chunkSize);
            buffer = buffer.slice(chunkSize);

            let base64 = "";
            const batchSize = 8192;
            for (let offset = 0; offset < slice.byteLength; offset += batchSize) {
              base64 += String.fromCharCode(
                ...slice.subarray(offset, Math.min(offset + batchSize, slice.byteLength))
              );
            }

            await sendMessage(MessageType.ProcessStreamChunk, {
              videoId: request.videoId,
              streamType,
              iChunk,
              totalChunks: 0, // Unknown total - processor handles this
              chunkBase64: btoa(base64),
              tabId
            });
            iChunk++;

            if (buffer.byteLength === 0) {
              break;
            }
          }

          if (done) {
            // Send a final marker chunk with the correct total
            await sendMessage(MessageType.ProcessStreamChunk, {
              videoId: request.videoId,
              streamType,
              iChunk: -1, // Marker: total count
              totalChunks: iChunk,
              chunkBase64: "",
              tabId
            });
            break;
          }
        }
      }

      await Promise.all([
        request.type !== "audio"
          ? streamToProcessor(videoStream, "video")
          : videoStream.cancel(),
        request.type !== "video"
          ? streamToProcessor(audioStream, "audio")
          : audioStream.cancel()
      ]);
      await sendMessage(MessageType.ProcessStreamEnd, {
        type: request.type,
        videoId: request.videoId,
        filenameOutput: request.filenameOutput,
        videoMimeType,
        audioMimeType,
        audioTrackLabels: [""],
        tabId
      });

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[ytdl:bg] SabrStream download failed:", errorMessage);
      void browser.storage.local.set({ ytdlBgDebug: `error: ${errorMessage}` });
      return false;
    }
  });

  onMessage(MessageType.PersistInterruptedDownload, async ({ data }) => {
    const current = await interruptedDownloadsItem.getValue();
    current[data.videoId] = data;
    await interruptedDownloadsItem.setValue(current);
  });

  onMessage(MessageType.ClearInterruptedDownload, async ({ data }) => {
    const current = await interruptedDownloadsItem.getValue();
    delete current[data.videoId];
    await interruptedDownloadsItem.setValue(current);
  });

  onMessage(MessageType.GetInterruptedDownload, async ({ data }) => {
    const current = await interruptedDownloadsItem.getValue();
    return current[data.videoId] ?? null;
  });

  onMessage(MessageType.ProcessStreamError, async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return;
    }

    console.error("[ytdl] Stream error for", data.videoId, data.error);
    await sendMessage(
      MessageType.UpdateDownloadProgress,
      {
        videoId: data.videoId,
        progress: 0,
        progressType: ProgressType.Video,
        isRemoved: true
      },
      tabId
    );
  });

  // Download via hidden iframe. The subscriptions page creates an iframe to
  // the watch page. The background injects a MAIN world script into the iframe
  // that spoofs visibilityState, plays at 4x, and captures SourceBuffer data.
  // No allFrames needed - executeScript targets the specific iframe frame.
  onMessage(MessageType.DownloadViaWatchPage, async ({ data, sender }) => {
    const originTabId = sender.tab?.id;
    if (!originTabId) {
      return;
    }

    const watchUrl = `https://www.youtube.com/watch?v=${data.videoId}&ytdl=1`;

    // Tell the subscriptions page to create the hidden iframe
    await sendMessage(MessageType.CreateDownloadIframe, {
      videoId: data.videoId,
      watchUrl
    }, originTabId);

    // Wait for iframe load signal
    await new Promise<void>(resolve => {
      const removeListener = onMessage(MessageType.DownloadIframeReady, ({ data: readyData }) => {
        if (readyData.videoId === data.videoId) {
          removeListener();
          resolve();
        }
      });
      setTimeout(() => {
        removeListener();
        resolve();
      }, 30_000);
    });

    // Wait for iframe content scripts and YouTube player to initialize.
    // Content scripts inject via allFrames: true (manifest + registerContentScripts).
    await new Promise(resolve => {
      return setTimeout(resolve, 8000);
    });

    // Send download request to the tab. The isWatchPage guard ensures
    // only the iframe's content script (on /watch) handles it.
    try {
      await sendMessage(MessageType.ExecuteDownloadItem, data, originTabId);
    } catch {
      await new Promise(resolve => {
        return setTimeout(resolve, 3000);
      });
      await sendMessage(MessageType.ExecuteDownloadItem, data, originTabId);
    }

    trackVideoForTab(data.videoId, originTabId);
    tabTracker[originTabId] ??= { videoIdsAvailable: [] };
    tabTracker[originTabId].videoIdsAvailable.push(data.videoId);

    // Keep SW alive
    await sendMessage(MessageType.StartKeepalive, { videoId: data.videoId }, originTabId);
  });

  // Keepalive ping from content scripts - resets SW idle timer
  onMessage(MessageType.Keepalive, () => {});

  onMessage(MessageType.RequestPlaylistDownload, async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return;
    }

    for (const item of data.items) {
      await sendMessage(MessageType.ExecuteDownloadItem, item, tabId);
    }
  });

  onMessage(MessageType.CancelDownload, async ({ data }) => {
    await cancelDownloads(data.videoIds);
  });

  // - Pipeline storage handlers (chrome.storage unavailable in offscreen) -

  onMessage(MessageType.PipelineProgress, async ({ data }) => {
    const {
      videoId, progress, progressType, tabId
    } = data;
    const current = await statusProgressItem.getValue();
    current[videoId] = {
      progress,
      progressType
    };
    await Promise.allSettled([
      sendMessage(MessageType.UpdateDownloadProgress, {
        videoId,
        progress,
        progressType
      }, tabId),
      statusProgressItem.setValue(current)
    ]);
  });

  onMessage(MessageType.PipelineRemoval, async ({ data }) => {
    const { videoId, tabId } = data;
    const current = await statusProgressItem.getValue();
    delete current[videoId];
    await Promise.allSettled([
      sendMessage(
        MessageType.UpdateDownloadProgress,
        {
          videoId,
          progress: 0,
          progressType: ProgressType.Video,
          isRemoved: true
        },
        tabId
      ),
      statusProgressItem.setValue(current)
    ]);
  });

  onMessage(MessageType.PipelineQueueRemove, async ({ data }) => {
    const { videoId } = data;
    const current = await statusProgressItem.getValue();
    delete current[videoId];
    await statusProgressItem.setValue(current);
  });

  onMessage(MessageType.PipelineFFmpegReady, async () => {
    await isFFmpegReadyItem.setValue(true);
  });

  onMessage(MessageType.PipelineDownload, async ({ data }) => {
    await browser.downloads.download({
      url: data.blobUrl,
      filename: data.filename
    });
  });

  // - Tab lifecycle -

  browser.tabs.onRemoved.addListener(async tabId => {
    // Reset Firefox processor tab if it was closed
    if (tabId === firefoxProcessorTabId) {
      firefoxProcessorTabId = null;
      processorReady = null;
      return;
    }

    const tracked = tabTracker[tabId];
    if (!tracked) {
      return;
    }

    delete tabTracker[tabId];
    clearCapturedSabrData(tabId);
    for (const videoId of tracked.videoIdsAvailable) {
      untrackVideoForTab(videoId, tabId);
    }
    await cancelDownloads(tracked.videoIdsAvailable);
  });

  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== "loading" || !tab.url?.includes("youtube.com")) {
      return;
    }

    const tracked = tabTracker[tabId];
    if (!tracked) {
      return;
    }

    for (const videoId of tracked.videoIdsAvailable) {
      untrackVideoForTab(videoId, tabId);
    }
    clearCapturedSabrData(tabId);
    await cancelDownloads(tracked.videoIdsAvailable);

    tabTracker[tabId] = { videoIdsAvailable: [] };
  });

  // - Initialization -

  browser.runtime.onInstalled.addListener(async () => {
    await clearLocalStorage();
  });
});

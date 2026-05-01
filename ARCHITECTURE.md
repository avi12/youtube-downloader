# Architecture

## Extension contexts

A browser extension runs code in four separate JavaScript environments. Understanding which context you are in is the first thing to figure out when navigating this codebase.

| Context | Entry point | Can access DOM | Can make network requests | Runs on |
|---|---|---|---|---|
| Background service worker | `src/entrypoints/background/` | No (Chrome) / Yes (Firefox) | Yes | Browser startup |
| Offscreen document | `src/entrypoints/offscreen/` | Yes | Yes | On demand |
| Content script - ISOLATED world | `src/entrypoints/youtube.content/` | Yes | No (CORS) | Every YouTube page |
| Content script - MAIN world | `src/entrypoints/youtube-main.content/` | Yes | No (CORS) | Every YouTube page |

The two content script worlds run on the same page but in different JavaScript contexts. MAIN world scripts share the page's global scope (so they can patch `SourceBuffer.prototype`). ISOLATED world scripts have their own scope and can call `browser.runtime.*` messaging APIs.

## Download flow

### Watch page (`/watch`)

1. `youtube-main.content` detects the video player and calls `startDownload()`.
2. The player's SABR fetch is intercepted by `sabr-fetch-interceptor.content` (MAIN world), which reads the response bytes as they arrive.
3. `sourcebuffer-capture.content` (MAIN world) patches `SourceBuffer.prototype.appendBuffer` to intercept every media chunk appended to the player.
4. Captured chunks are sent cross-world (MAIN → ISOLATED) via a custom event (`cross-world-messenger.ts`).
5. The ISOLATED world content script forwards chunks to the background via `browser.runtime.sendMessage` (`StreamChunk` message).
6. The background forwards chunks to the offscreen document over a long-lived port (`offscreen-messaging.ts`).
7. The offscreen document accumulates all chunks (`stream/accumulator.ts`) and, when complete, runs FFmpeg to mux video + audio (`download-pipeline/`).
8. FFmpeg outputs a Blob URL; the offscreen document sends it back to the background which triggers `browser.downloads.download`.

### Grid/subscriptions/channel pages (iframe-scrub path)

These pages don't have a player, so SABR bytes can't be captured directly. Instead:

1. `youtube.content` injects download buttons into video cards.
2. On click, it sends `StartIframeScrub` to the background with the video ID, duration, and format metadata.
3. The background `scrub/orchestrator.ts` computes how many 35-second windows cover the full duration and creates a `ScrubSession`.
4. `scrub/iframe-scheduler.ts` spawns one hidden YouTube player iframe at a time inside the offscreen document.
5. Each iframe loads `youtube.com/watch?v=ID&t=N&ytdlScrubMode=1` (a paused player seeked to position N).
6. The player's natural buffer-ahead fetches ~35s of SABR data. `sourcebuffer-capture.content` (MAIN world, auto-injected because the iframe URL matches `youtube.com/*`) patches `appendBuffer` and sends chunks cross-world.
7. The ISOLATED world content script in the iframe sends the captured segment to the background via a long-lived port (`scrub-iframe-messaging.ts`).
8. `scrub/segment-handler.ts` validates and stores the segment in the session.
9. When all segments arrive, `scrub/session-finalizer.ts` sends each segment to the offscreen document and fires `ProcessStreamEnd`.
10. The offscreen document's FFmpeg pipeline concatenates the segments into a single MKV (or MP4) and triggers the download.

## Key directories

```
src/
  entrypoints/
    background/
      scrub/           Iframe-scrub orchestration (session lifecycle, iframe scheduling, segment collection)
      handlers/        Message handlers registered at background startup
      download/        Download retry, extra audio tracks, format resolution helpers
      iframe-host/     Sends SpawnIframe/RemoveIframe commands to the offscreen document
      queue/           Tracks which videos are available per browser tab
    offscreen/
      stream/          Accumulates binary chunks and reassembles complete streams
    youtube.content/   ISOLATED-world content scripts (button injection, message forwarding)
    youtube-main.content/ MAIN-world content scripts (player patching, capture, download trigger)
    sourcebuffer-capture/ Patches SourceBuffer to intercept media bytes
  lib/
    download-pipeline/ FFmpeg processing: concat, transcode, mux, ZIP
    messaging/         All cross-context message protocols and utilities
    utils/             Binary helpers, MIME mapping, media-init parsing
    youtube/           YouTube-specific: SABR proto, PO token, botguard, format selection
  components/          Svelte UI: download panel, playlist downloader, popup
```

## Messaging between contexts

Three distinct messaging channels are used:

| Channel | File | Used for |
|---|---|---|
| MAIN ↔ ISOLATED (same page) | `lib/messaging/cross-world-messenger.ts` | Sending captured media bytes from MAIN to ISOLATED world |
| Scrub iframe → Background | `lib/messaging/scrub-iframe-messaging.ts` | Long-lived port; ISOLATED world in each scrub iframe sends completed segments |
| Background ↔ Offscreen | `lib/messaging/offscreen-messaging.ts` | Long-lived port; background sends binary chunks and control messages |
| Any content script → Background (one-shot) | `lib/messaging/messaging.ts` | All other typed messages via `@webext-core/messaging` |

## Glossary

- **SABR** - YouTube's internal streaming format. Responses are protocol-buffer encoded and contain the raw video/audio bytes for a given time window.
- **Init segment** - The first few bytes of a WEBM/MP4 stream that describe the codec and container. Every concat segment must begin with one.
- **Scrub session** - One download job broken into N sequential iframe captures (one per 35-second window).
- **Offscreen document** - A Chrome MV3 API that gives the background a DOM context without opening a visible tab. Firefox uses a hidden `<iframe>` injected into the background page's `document.body` instead.
- **MAIN world** - The content script execution context that shares `window` with the page's own JavaScript. Required for patching browser built-ins like `SourceBuffer`.
- **ISOLATED world** - The default content script context, sandboxed from the page. Has access to `browser.*` extension APIs.

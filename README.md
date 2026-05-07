# YouTube Downloader

A browser extension for downloading YouTube videos with full format control, batch playlist downloads, and a built-in
download manager.

Made by [Avi](https://avi12.com)

## Supported browsers

<p>
  <img src="https://user-images.githubusercontent.com/6422804/135838451-1c3ac8f1-409f-4aec-972f-1d077c05f1ea.png" width="30" alt="Google Chrome">
  <img src="https://user-images.githubusercontent.com/6422804/135838702-e852bb47-8c0d-4275-baf1-8adc1c50a3c1.png" width="30" alt="Microsoft Edge">
  <img src="https://user-images.githubusercontent.com/6422804/135838972-113f73a3-6a04-48a9-ae04-754f25bc6eb0.png" width="30" alt="Opera">
  <img src="https://user-images.githubusercontent.com/6422804/135838972-113f73a3-6a04-48a9-ae04-754f25bc6eb0.png" width="30" alt="Opera GX">
  <img src="https://upload.wikimedia.org/wikipedia/commons/a/a0/Firefox_logo%2C_2019.svg" width="30" alt="Firefox">
</p>

Chrome, Edge, Opera, Opera GX, and Firefox (all MV3).

## Features

### Watch page (`/watch`)

- Download button injected next to YouTube's native controls
- Tooltip shows the filename and quality before you click
- Music videos auto-select audio-only download; everything else defaults to video + audio
- Configurable default download type (auto, video + audio, video only, audio only)

### Playlist page (`/playlist`)

- Per-video download buttons and checkboxes injected into each playlist item
- Batch download selected videos with one click
- **Speed** - choose between sequential (one at a time) or parallel (muxing phases overlap, SABR sessions stay
  sequential)
- **Output** - separate files or a single ZIP archive; customize the ZIP filename
- **Type** - video + audio, video only, or audio only for the whole batch
- **Format** - per-type file extension override (e.g. force `.mp3` for audio)
- "Download all when ready" - queues every video in the playlist as items load
- "Scroll to the current video" option - auto-scrolls to whichever video is actively downloading
- Select all / deselect all actions
- Individual downloads are cancellable mid-flight

### Subscriptions, channel pages, and search

- Download buttons injected directly into YouTube's video card menus
- Uses background service-worker fetch to bypass CORS restrictions on `googlevideo.com`
- Downloads resume automatically on a flaky connection - partial progress is not lost

### Popup - Download manager

- Live progress bars for every active download (video, audio, processing, ZIP phases)
- Cancel individual downloads or cancel all at once
- Downloads resume automatically if the connection drops mid-transfer
- Recent downloads list - thumbnail, title, channel, file size, relative timestamp
- Per-item actions: show in folder, change format, remove from history

### Global options (popup settings tab)

- Default download type (auto / video + audio / video only / audio only)
- Video file extension (mp4, webm, mkv, ...)
- Audio file extension (mp3, m4a, opus, ogg, ...)
- Default video quality (highest available or a specific resolution)
- Toggle removal of YouTube's native download button

## How downloads work

YouTube serves video and audio as separate SABR streams (Scalable Adaptive Bit Rate - an internal Google protocol where the client sends a protobuf request and receives a UMP-encoded response containing media chunks). The extension downloads both streams and muxes them locally using FFmpeg WASM.

### Download resolution (`background/download/download-resolver.ts`)

Every download attempt walks the same priority ladder regardless of browser:

1. **CDN-first** - if the video has a pre-signed CDN URL, fetch it directly (`cdn-downloader.ts`). This is the fast path and avoids SABR entirely.
2. **Direct SABR** - send a synthetic `VideoPlaybackAbrRequest` from the background service worker (`sabr-downloader.ts`). The request is built from a captured copy of the player's own SABR POST body (`lib/youtube/sabr/request-capture.ts`), which carries the session tokens and PO token the server requires. A stall guard wraps each attempt and retries up to 3 times on a 30 s silence (`sabr-stall-guard.ts`).
3. **Browser-specific fallback** - when the above fails, Chrome and Firefox diverge (see below).

### Chrome fallback - progressive SABR in-tab

If the background has no captured SABR data for the tab yet, it first primes the capture by spawning a hidden iframe inside the offscreen document (`offscreen-sabr-primer.ts` + `primer-capture.ts`). The iframe loads the YouTube player, which fires a SABR request that the `webRequest` listener intercepts.

If direct SABR still stalls after priming, the background sends `RunProgressiveSabrInTab` to the YouTube tab. The `sabr-fetch-interceptor` content script (MAIN world, `entrypoints/sabr-fetch-interceptor/`) takes over: it builds a SABR template from its own intercepted fetch, drives successive requests through the player's network stack, and streams the resulting bytes back to the background.

### Firefox fallback - iframe-scrub

For videos ≥ 240 s, Firefox uses the iframe-scrub path (`background/download/iframe-scrub-fallback.ts`). The video duration is divided into 35 s windows and one hidden `<iframe>` is spawned per window sequentially inside the background page (`scrub/iframe-scheduler.ts`). Each iframe loads `youtube.com/watch?v=ID&t=N` with a paused player; the player's natural buffer-ahead fetches the SABR data for that window. A MAIN-world content script patches `SourceBuffer.prototype.appendBuffer` to intercept every media chunk (`sourcebuffer-capture.content`), which is relayed back to the background via a long-lived port (`lib/messaging/scrub-iframe-messaging.ts`). `scrub/segment-handler.ts` validates each arriving segment (size floor: 50 KB/s for video, 16 KB/s for audio) and retries up to 4 times if undersized. When all segments have arrived, `scrub/session-finalizer.ts` prepends the stream's init segment to each chunk and forwards everything to the processor for muxing.

For videos under 240 s, Firefox falls through to direct SABR (step 2 above).

### Muxing (`entrypoints/offscreen/` + `lib/download-pipeline/`)

Once all raw bytes are collected they go to an FFmpeg WASM instance:

- **Chrome** - runs inside a dedicated offscreen document (`browser.offscreen.createDocument`), which provides a DOM context the service worker lacks.
- **Firefox** - runs inside a hidden `<iframe>` injected into the background page's `document.body` (same offscreen source, different host).

The offscreen code accumulates incoming chunks in `stream/accumulator.ts`, then on `ProcessStreamEnd` calls into `lib/download-pipeline/` to write input files to FFmpeg's in-memory filesystem and invoke `ffmpeg.exec`. The mux strategy depends on what arrived:

| Input | Handler |
|---|---|
| Separate video + audio streams | `process-video-audio.ts` |
| Multiple ordered scrub segments | `process-multipart-segments.ts` |
| Single stream (audio-only) | `process-single-media.ts` |

FFmpeg progress events feed back to the watch-page progress ring via `PipelineProgress` messages. When FFmpeg finishes, the output buffer is handed to `browser.downloads.download` (or appended to a ZIP for batch downloads).

## Development

### Requirements

- [Node.js](https://nodejs.org) (for running the dev server via `tsx`)
- [pnpm](https://pnpm.io)

### Setup

```bash
pnpm i
```

### Dev server (Chrome, auto-reload on file save)

```bash
pnpm dev:stable
```

### Dev server (Firefox)

```bash
pnpm dev:stable-firefox
```

The dev server builds for production (with source maps), launches a browser with the extension sideloaded, and reloads
both the extension and any open YouTube tabs on every file change under `src/`.

### Other dev commands

```bash
pnpm dev                  # WXT dev mode (Chrome)
pnpm dev:with-profile     # WXT dev mode with your Chrome profile
pnpm dev:firefox          # WXT dev mode (Firefox)
pnpm build                # Production build (Chrome)
pnpm build:firefox        # Production build (Firefox)
pnpm svelte:check         # Svelte type-check
pnpm lint                 # ESLint + Stylelint
pnpm knip                 # Dead code detection
```

## Tech stack

| Layer               | Package                                                     |
|---------------------|-------------------------------------------------------------|
| Extension framework | [WXT](https://wxt.dev)                                      |
| UI                  | [Svelte 5](https://svelte.dev)                              |
| Video/audio muxing  | [@ffmpeg/ffmpeg](https://github.com/ffmpegwasm/ffmpeg.wasm) |
| Messaging           | [@webext-core/messaging](https://webext-core.aklinker1.io)  |
| Streaming           | SABR (YouTube's Scalable Adaptive Bit Rate protocol)        |

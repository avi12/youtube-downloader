# YouTube Downloader

A browser extension for downloading YouTube videos with full format control, batch playlist downloads, and a built-in
download manager

Made by [Avi](https://avi12.com) with supervised [Claude Code](https://claude.com/product/claude-code)

## Supported browsers

<p>
  <img src="https://user-images.githubusercontent.com/6422804/135838451-1c3ac8f1-409f-4aec-972f-1d077c05f1ea.png" width="30" alt="Google Chrome">
  <img src="https://user-images.githubusercontent.com/6422804/135838702-e852bb47-8c0d-4275-baf1-8adc1c50a3c1.png" width="30" alt="Microsoft Edge">
  <img src="https://user-images.githubusercontent.com/6422804/135838972-113f73a3-6a04-48a9-ae04-754f25bc6eb0.png" width="30" alt="Opera">
  <img src="https://upload.wikimedia.org/wikipedia/commons/e/e7/Opera_GX_Icon.svg?utm_source=commons.wikimedia.org&utm_campaign=index&utm_content=original" width="30" alt="Opera GX">
</p>

Chrome, Edge, Opera, and Opera GX (all MV3).

## Features

### Watch page (`/watch`)

- Download button injected next to YouTube's native controls
- Tooltip shows the filename and quality before you click
- Music videos auto-select audio-only; everything else defaults to video + audio
- Configurable default download type (auto, video + audio, video only, audio only)

### Playlist page (`/playlist`)

- Per-video download buttons and checkboxes injected into each playlist item
- Batch download selected videos with one click
- **Speed** - sequential (one at a time) or parallel (muxing phases overlap, SABR sessions stay sequential)
- **Output** - separate files or a single ZIP archive; customize the ZIP filename
- **Type** - video + audio, video only, or audio only for the whole batch
- **Format** - per-type file extension override (e.g. force `.mp3` for audio)
- "Download all when ready" - queues every video in the playlist as items load
- "Scroll to the current video" - auto-scrolls to whichever video is actively downloading
- Select all / deselect all actions
- Individual downloads are cancellable mid-flight

### Subscriptions, channel pages, and search

- Download buttons injected directly into YouTube's video card menus
- Uses background service worker fetch to bypass CORS restrictions on `googlevideo.com`
- Downloads resume automatically on a flaky connection - partial progress is never lost

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
pnpm dev
```

Builds for production (with source maps), launches Chrome with the extension sideloaded, and reloads
both the extension and any open YouTube tabs on every file change under `src/`.

### Other dev commands

```bash
pnpm build         # Production build
pnpm svelte:check  # Svelte type-check
pnpm lint          # ESLint + Stylelint
pnpx fallow audit  # Dead code detection
```

## Tech stack

| Layer               | Package                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Extension framework | [WXT](https://wxt.dev)                                                                               |
| UI                  | [Svelte 5](https://svelte.dev)                                                                       |
| Streaming           | SABR (YouTube's Scalable Adaptive Bit Rate protocol) via [`googlevideo`](https://npm.im/googlevideo) |
| Muxing              | [`@ffmpeg/ffmpeg`](https://npm.im/@ffmpeg/ffmpeg) (WASM build, runs in an offscreen document)        |
| Messaging           | [`@webext-core/messaging`](https://npm.im/@webext-core/messaging)                                    |

## How it works

The extension is split across five MV3 runtimes (each lives under `src/entrypoints/`):

| Runtime                   | Folder                  | Job                                                                                                             |
| ------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| Service worker            | `background/`           | Owns downloads, SABR/CDN fetches, declarativeNetRequest header rewrites, tab tracking, persistence              |
| MAIN-world content script | `youtube-main.content/` | Reads YouTube's Polymer state (player config, video metadata) and injects the download button                   |
| Isolated content script   | `youtube.content/`      | Bridge between MAIN world and the service worker; mounts Svelte UI (toasts, grid overlays, playlist downloader) |
| Offscreen document        | `offscreen/`            | Runs [`@ffmpeg/ffmpeg`](https://npm.im/@ffmpeg/ffmpeg) WASM to mux video + audio streams                        |
| Popup                     | `popup/`                | Download manager UI (active progress + recent history + settings)                                               |

### Fetching streams from YouTube

YouTube serves video and audio as separate adaptive streams. The extension tries two methods in order:

**1. SABR (Scalable Adaptive Bit Rate)** - YouTube's internal streaming protocol. The extension uses [`googlevideo`](https://npm.im/googlevideo) to speak this protocol, making requests look like a real player session. SABR gives the best compatibility and avoids CDN rate limits.

The SABR session lives in the service worker (`background/download/sabr-downloader.ts`). Because the service worker can't directly reach `googlevideo.com` (CORS), a `declarativeNetRequest` rule rewrites the `Origin` header on outgoing requests so YouTube accepts them.

If a video has multiple audio tracks (dubbed versions), SABR downloads them sequentially after the main stream.

**2. CDN fallback** - If SABR fails (e.g. for very old or live-clipped videos), the extension falls back to direct CDN URLs from the player response (`background/download/cdn-downloader.ts`). These are plain HTTPS fetches with byte-range support for retrying interrupted transfers.

### Additional audio tracks

When a video has multiple dubbed or language variants, the extension downloads all of them automatically.

`getExtraAudioFormats()` in `youtube-main.content/video/download.ts` collects every audio track whose `audioTrack.id` differs from the user's chosen primary track (up to 16 extras). These are passed in the `DownloadRequest` as `additionalAudioFormats`.

In the background:

- **SABR** - `downloadExtraAudioTracksViaSabr()` fetches each extra track sequentially (one SABR session per track). Sequential ordering avoids overloading the session slot limit.
- **CDN** - `resolvedExtraAudioUrls` are fetched in parallel alongside the main video and audio.

After downloading, each extra track is passed to the offscreen document with its `label`, `languageCode`, and `isDefault` flag. FFmpeg maps them as separate audio streams in the output file (MKV only; MP4 and WebM carry a single audio track).

### Closed captions

Caption tracks are fetched in the content script **before** the background download starts, concurrently with format resolution.

`fetchCaptionVttData()` in `youtube-main.content/video/download.ts`:

1. Calls `fetchFreshCaptionUrls(videoId)` - sends an InnerTube `player` request to get non-expired `baseUrl` values for each caption track (the URLs baked into the player config expire quickly)
2. For each ordered track, appends `?fmt=vtt` and fetches the raw VTT text
3. Returns the VTT strings as base64-encoded data alongside their `vssId`, language code, and display name

`orderCaptionsByPreference()` sorts tracks according to the user's language setting so the default subtitle stream in the output file matches the UI language.

The caption data travels in `captionVttData` inside `DownloadRequest`. Because captions are fully downloaded before the background service worker starts, they count as pre-completed stages in the proportional progress calculation - the download bar starts already past the caption share.

FFmpeg receives each VTT string as a virtual input file and muxes it as a subtitle stream (`-c:s copy` for MKV; captions are skipped for MP4/WebM since those containers don't embed WebVTT streams reliably).

### Thumbnail and YouTube Music ID3 metadata

**Thumbnail source** - `buildVideoMetadata()` in `youtube-main.content/video/video-data.ts` takes the highest-resolution thumbnail URL from the player's `videoDetails.thumbnail.thumbnails` array and stores it in `metadata.thumbnailUrl`.

**YouTube Music enrichment** - For videos where `metadata.isMusic` is true (YouTube Music tracks), `enrichMetadataFromYouTubeMusic()` in `background/download/background-downloader.ts` queries `music.youtube.com/youtubei/v1/search` using the `WebRemix` InnerTube client with a Songs filter. It reads the first `musicResponsiveListItemRenderer` result:

- Column 1 → song title
- Column 2 runs → artist names (runs whose `pageType` is `MUSIC_PAGE_TYPE_ARTIST`) and album (`MUSIC_PAGE_TYPE_ALBUM`)
- Thumbnail → last entry in the thumbnail list, resized to 544×544 via URL rewriting (`=w544-h544`)

This overrides whatever title/artist/album the standard player response provided, giving ID3 tags that match the YouTube Music catalogue entry.

**Thumbnail embedding** - In the mux worker, `fetchThumbnail()` fetches the thumbnail URL after rewriting WebP paths to JPEG (`/vi_webp/` → `/vi/`, `.webp` → `.jpg`). The actual image format is then confirmed by magic bytes (`FF D8 FF` = JPEG, `89 50 4E 47` = PNG, RIFF+WEBP = WebP) so the correct file extension is set regardless of the URL. The image is written as a virtual FFmpeg input and embedded as an attached picture. Thumbnail embedding is only applied to MP3 and M4A outputs; WebM/MKV containers don't receive it since those formats don't have a standardised cover art field.

FFmpeg also writes the full ID3/metadata block: title, artist, album\_artist, album, genre, date, and track number.

### YouTube authentication

**PO token (Proof of Origin)** - YouTube requires a cryptographic proof that requests come from a real browser session, not a bot. The extension generates this by running YouTube's own **BotGuard** anti-bot JavaScript:

1. Fetches a challenge from YouTube's InnerTube `att/get` endpoint
2. Loads (or reuses) the BotGuard interpreter script in the MAIN world
3. Runs the interpreter to get a "snapshot" of the browser environment
4. Submits the snapshot to `api/jnn/v1/GenerateIT` to receive an integrity token
5. Uses the integrity token to mint a per-video PO token

The full process is in `src/lib/youtube/po-token-generator.ts`. Without a valid token, YouTube returns `403 Forbidden`.

On the watch page the player already runs BotGuard, so the extension captures the resulting SABR URL and PO token directly from the player's own requests (via `src/lib/youtube/sabr/request-capture.ts`). On grid/subscription pages where the player isn't running, the extension generates a fresh token using the process above.

**Signature cipher** - CDN stream URLs are sometimes protected by an obfuscated JavaScript transform that has to be applied to decrypt the `sig` parameter before the URL is usable. The extension:

1. Downloads the player's `player.js`
2. Extracts the transform function and its operations (swap, reverse, splice) by pattern-matching against known obfuscation patterns
3. Replays the operations locally to produce the decrypted signature

This is in `src/lib/youtube/signature-decryptor.ts` and is called by `src/entrypoints/youtube-main.content/video/stream-fetch.ts` when a format has a `signatureCipher` field instead of a plain URL.

### Muxing

Raw video and audio are separate `.webm`/`.mp4` streams. After all bytes are downloaded, the service worker ships them to an **offscreen document** (`offscreen/`) which runs [`@ffmpeg/ffmpeg`](https://npm.im/@ffmpeg/ffmpeg) (a WASM build). FFmpeg merges the streams, re-encodes if needed (e.g. WebM audio into an MP4 container), and emits the final file.

The offscreen document exists because the service worker can't host the large WASM binary or stream data reliably - the offscreen document has a stable lifetime and full Blob/ArrayBuffer support.

### Download flow (single watch-page video)

1. User clicks the injected button - `youtube-main.content/watch-button/watch-button.ts` calls `performDownload(...)`
2. `youtube-main.content/video/download.ts` builds a `DownloadRequest` and posts it cross-world via `crossWorldMessenger`
3. `youtube.content/index.ts` forwards it to the service worker as `StartBackgroundDownload`
4. `background/handlers/download-handlers.ts` enqueues the video and calls `startBackgroundDownload(...)`
5. `background/download/background-downloader.ts` tries SABR first (via [`googlevideo`](https://npm.im/googlevideo)), falls back to CDN if SABR fails
6. Bytes stream to the offscreen document via `dispatchToOffscreen(...)`
7. [`@ffmpeg/ffmpeg`](https://npm.im/@ffmpeg/ffmpeg) muxes the streams and produces the final file
8. The pipeline posts a blob URL back to the service worker, which calls `browser.downloads.download(...)` to save it to disk

### Resilience

- If the connection drops mid-fetch, the service worker persists the request and re-fires it on the next `online` event
- If the user clicks cancel, both the in-flight SABR fetch and any pending FFmpeg mux are killed, and the persisted retry is dropped - so a manual cancel never gets resurrected

## Contributor guide

### Runtimes and messaging

Chrome content scripts run in an **isolated world** - same DOM as the page, but a separate JavaScript scope. Two message buses connect the runtimes:

| Bus                   | File                                         | Scope                                   |
| --------------------- | -------------------------------------------- | --------------------------------------- |
| `crossWorldMessenger` | `src/lib/messaging/cross-world-messenger.ts` | MAIN world to isolated world (same tab) |
| `sendMessage`         | `src/lib/messaging/messaging.ts`             | Content scripts to service worker       |

Both are built on [`@webext-core/messaging`](https://npm.im/@webext-core/messaging). To add a new message type, extend the relevant `enum`/`const` map and register a handler with `onMessage`.

### Backend: adding or changing download logic

The core download path lives in `src/entrypoints/background/`:

- `download/background-downloader.ts` - orchestrates the SABR/CDN/iframe fallback chain
- `download/sabr-downloader.ts` - constructs and sends SABR requests via [`googlevideo`](https://npm.im/googlevideo); extra audio tracks (dubbed versions) are fetched sequentially and their byte counts contribute to the unified progress counter
- `download/cdn-downloader.ts` - direct CDN fetch with byte-range retry for flaky connections
- `download/progress-fetch.ts` - wraps `fetch` to count received bytes and throttle progress updates

SABR requests need a valid `Origin: https://www.youtube.com` header. The service worker can't set this directly (Chrome strips it), so `wxt.config.ts` registers a `declarativeNetRequest` rule that rewrites the header on outgoing requests to `googlevideo.com`.

The offscreen mux pipeline starts in `src/entrypoints/offscreen/` and uses [`@ffmpeg/ffmpeg`](https://npm.im/@ffmpeg/ffmpeg). `src/lib/download-pipeline/index.ts` is the entry point that receives raw streams and drives FFmpeg to produce the final file.

### UI: working with Polymer elements

The download button and panel are injected into YouTube's Polymer-based UI. YouTube's custom elements (`yt-button-view-model`, `tp-yt-paper-progress`, `tp-yt-paper-input`) have JavaScript property setters defined in the MAIN world. The panel runs in the isolated world, so:

- **Button configuration** has to go through `sendButtonData()` in `src/lib/ui/polymer-utils.ts`, which sends the data via `crossWorldMessenger` to the MAIN world where the setter is actually invoked
- **CSS custom properties** on Polymer elements must be set via `element.updateStyles({ "--var": "value" })`, not inline styles, so Polymer's Shady DOM picks them up
- `WatchButton.svelte` is the exception - it runs in `youtube-main.content` (MAIN world) and can set `.data` directly

Svelte 5's `{@attach fn}` directive is used for one-time Polymer element setup. The `fn(element)` callback runs after insertion and can return a cleanup function. See `src/lib/ui/panel-button-attachments.svelte.ts` for examples.

### Good first issues

| Area                   | Where to start                                       |
| ---------------------- | ---------------------------------------------------- |
| SABR streaming         | `src/lib/youtube/sabr/`                              |
| Download orchestration | `src/entrypoints/background/download/`               |
| FFmpeg muxing pipeline | `src/entrypoints/offscreen/`                         |
| Download panel         | `src/components/download-options-panel/`             |
| Watch-page button      | `src/entrypoints/youtube-main.content/watch-button/` |
| Playlist downloader    | `src/components/playlist-downloader/`                |
| Shared types           | `src/types/index.ts`                                 |

After any change under `src/`, the dev server (`pnpm run dev`) auto-rebuilds and reloads the extension and YouTube tabs. Run `pnpm run lint`, `pnpm run svelte:check`, and `pnpx fallow audit` before committing.

# YouTube Downloader

An MV3 browser extension that reverse-engineers YouTube's internal streaming infrastructure to download videos, playlists, and subscriptions - with full format control, multi-track audio, embedded subtitles, and a live download manager. Runs on Chromium and Firefox.

Built by [Avi](https://avi12.com) with supervised [Claude Code](https://claude.com/product/claude-code)

<p>
  <img src="https://user-images.githubusercontent.com/6422804/135838451-1c3ac8f1-409f-4aec-972f-1d077c05f1ea.png" width="30" alt="Google Chrome">
  <img src="https://user-images.githubusercontent.com/6422804/135838702-e852bb47-8c0d-4275-baf1-8adc1c50a3c1.png" width="30" alt="Microsoft Edge">
  <img src="https://user-images.githubusercontent.com/6422804/135838972-113f73a3-6a04-48a9-ae04-754f25bc6eb0.png" width="30" alt="Opera">
  <img src="https://upload.wikimedia.org/wikipedia/commons/e/e7/Opera_GX_Icon.svg?utm_source=commons.wikimedia.org&utm_campaign=index&utm_content=original" width="30" alt="Opera GX">
  <img src="https://upload.wikimedia.org/wikipedia/commons/a/a0/Firefox_logo%2C_2019.svg" width="30" alt="Firefox">
</p>

## Installation

### 1. Download

Grab the latest zip for your browser from the [Releases page](https://github.com/avi12/youtube-downloader/releases):

- Chromium browsers: `youtube-downloader-*-chrome.zip`
- Firefox: `youtube-downloader-*-firefox.zip`

### 2. Sideload

**Chrome**
1. Go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Drag and drop the zip onto the page

**Edge**
1. Go to `edge://extensions`
2. Enable **Developer mode** (left sidebar)
3. Drag and drop the zip onto the page

**Opera / Opera GX**
1. Go to `opera://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Drag and drop the zip onto the page

**Firefox**
1. Unzip the Firefox zip
2. Go to `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on** and pick the `manifest.json` inside the unzipped folder

> Firefox 128+ required. Temporary add-ons are removed when Firefox restarts; for a permanent install, sign and install the build via [AMO](https://addons.mozilla.org).

## Tech stack

| Package | Purpose |
| --- | --- |
| [WXT](https://wxt.dev) | Extension build framework (MV3, hot-reload, sandboxed pages) |
| [Svelte 5](https://svelte.dev) | UI for content scripts and popup |
| [@ffmpeg/core](https://ffmpegwasm.netlify.app) | FFmpeg compiled to WASM - muxes video, audio, subtitles, and cover art in-browser |
| [@webext-core/messaging](https://webext-core.aklinker1.io/messaging) | Typed message passing between extension contexts |
| [googlevideo](https://npm.im/googlevideo) | YouTube SABR adaptive streaming protobuf protocol |
| [fflate](https://npm.im/fflate) | ZIP compression for batch downloads |

## Technical highlights

### 1. Click - deciding what to download

[`watch-button-click.ts`](src/entrypoints/youtube-main.content/watch-button/watch-button-click.ts) handles the button click. If a download is already running for that video it cancels it by emitting a `CrossWorldMessage.CancelDownload`. Otherwise it calls [`startDownload()`](src/entrypoints/youtube-main.content/video/download.ts) with the chosen download type (video+audio, video-only, audio-only).

### 2. Request assembly - reading YouTube's internal state

[`startDownload()`](src/entrypoints/youtube-main.content/video/download.ts) calls [`resolveAndDispatch()`](src/entrypoints/youtube-main.content/video/download-execute.ts), which collects everything the background will need - in parallel:

- The best video and audio itags for the requested quality
- Fresh caption URLs (the ones baked into the player config expire quickly) and each subtitle track downloaded as a VTT string
- The player's SABR streaming URL and ustreamer config blob
- Itags for any dubbed audio tracks

All of this is packed into a single `DownloadRequest` object. The content script runs in YouTube's MAIN world and can read Polymer state directly - the background can't - so all resolution happens here, upfront, before any message is sent.

### 3. Audio tracks and captions - resolving multi-language content

**Audio tracks**: YouTube embeds every available audio variant inside `streamingData.adaptiveFormats`. Each format that carries an `audioTrack` object represents a separate language or dub. [`audio-format-helpers.ts`](src/lib/youtube/audio-format-helpers.ts) identifies the original track by a four-step fallback: a format with no `audioTrack` at all wins first; otherwise it checks for an ID ending in `.4`, a display name containing `"(original)"`, or the `audioIsDefault` flag - in that order. Auto-dubbed tracks carry IDs ending in `.10`. [`download-execute.ts`](src/entrypoints/youtube-main.content/video/download-execute.ts) collects the primary audio format plus every extra language into `additionalAudioFormats`, de-duplicated by language code, so the background can fetch all of them in parallel.

**Single-track language tagging**: YouTube only supplies an `audioTrack` object when there's UI ambiguity to resolve (a language picker in the player), so single-language uploads carry no `audioTrack.id` or `audioTrack.displayName`. [`download-request-builder.ts`](src/entrypoints/youtube-main.content/video/download-request-builder.ts) recovers both pieces of metadata so FFmpeg can tag the stream correctly and VLC labels it `"Hebrew - [Hebrew]"` instead of `"Track 1 - [English]"`. Language code resolves via a three-step chain: explicit `audioTrack.id` (wins for multi-track), `HTMLVideoElement.audioTracks[enabled].language` (when the player has populated the track list), then the first non-translated entry in the source caption list. Track title resolves to `audioTrack.displayName` when present, otherwise `new Intl.DisplayNames(["en"], { type: "language" }).of(languageCode)` derives the English language name from the resolved code.

**Captions**: The `baseUrl` values baked into the initial player config expire within seconds of page load. [`caption-urls.ts`](src/entrypoints/youtube-main.content/video/caption-urls.ts) re-fetches a fresh set by POSTing an InnerTube request to `/youtubei/v1/player`, then extracts `captions.playerCaptionsTracklistRenderer.captionTracks` and builds a `vssId -> baseUrl` map. For each selected track, [`caption-fetch.ts`](src/entrypoints/youtube-main.content/video/caption-fetch.ts) injects a `<track kind="metadata">` element onto the page's video element, waits for its `load` event (10-second timeout), reads the browser-parsed `TextTrackCue` objects, serializes them back to WebVTT, and base64-encodes the result. The strings travel inside the `DownloadRequest` and are passed straight to FFmpeg as subtitle streams.

### 4. Authentication - BotGuard and PO tokens

YouTube gates SABR access behind a cryptographic Proof-of-Origin token. [`po-token-generator.ts`](src/lib/youtube/po-token-generator.ts) generates it by executing YouTube's own BotGuard anti-bot interpreter in the MAIN world, submitting the resulting browser environment snapshot to YouTube's `api/jnn/v1/GenerateIT` integrity endpoint, and minting a per-video token from the response - entirely client-side, no backend required.

On the watch page the player has already run BotGuard, so [`request-capture.ts`](src/lib/youtube/sabr/request-capture.ts) intercepts the player's own SABR requests to extract the URL and token directly instead of re-running the challenge.

For CDN stream URLs that carry a `signatureCipher` field, [`signature-decryptor.ts`](src/lib/youtube/signature-decryptor.ts) downloads `player.js`, pattern-matches the obfuscated transform function (swap, reverse, splice operations), and replays it locally to decrypt the `sig` parameter before the URL is used.

### 5. Message routing - crossing the MV3 world boundaries

MV3 fragments execution across isolated runtimes that can't share memory. The `DownloadRequest` travels over two buses in series:

- **MAIN world -> isolated world** via [`cross-world-messenger.ts`](src/lib/messaging/cross-world-messenger.ts) - a typed `dispatchEvent` / `addEventListener` bridge between the two JavaScript scopes sharing the same DOM
- **Isolated world -> service worker** via [`messaging.ts`](src/lib/messaging/messaging.ts) - a typed wrapper over `browser.runtime.sendMessage` from `@webext-core/messaging`

[`download-handlers.ts`](src/entrypoints/background/handlers/download-handlers.ts) receives `StartBackgroundDownload` on the other end, associates the download with the originating tab, enqueues it in the popup, and calls [`startBackgroundDownload()`](src/entrypoints/background/download/background-downloader.ts).

### 6. Dispatching to the download worker

[`startBackgroundDownload()`](src/entrypoints/background/download/background-downloader.ts) splits on browser and request type. Chrome MV3 has `chrome.offscreen`; Firefox MV3 does not, and that single API check (`isFirefoxRuntime()` in [`background-downloader.ts`](src/entrypoints/background/download/background-downloader.ts)) gates the entire download path:

- **Audio-only with SABR config** (both browsers) - sends `DownloadAudioViaSabr` directly to the offscreen document, which handles the SABR session in [`sabr-audio-download.ts`](src/entrypoints/offscreen/sabr-audio-download.ts)
- **Firefox, anything else** - calls [`runFirefoxDirectDownload()`](src/entrypoints/background/download/firefox-direct-download.ts) inline in the background. See section 7b for why Firefox can't use SABR
- **Chrome, anything else** (video+audio, video-only, CDN audio) - sends `StartDownloadInIframe` to the offscreen document

For the iframe path, [`main.ts`](src/entrypoints/offscreen/main.ts) in the offscreen document receives the message and calls [`createWorkerIframe()`](src/entrypoints/offscreen/iframe-host.ts), which spawns a sandboxed `<iframe>` running [`download-worker/main.ts`](src/entrypoints/download-worker/main.ts). The background service worker never touches the stream bytes directly on Chrome - all network I/O happens inside this worker iframe.

The offscreen host itself differs by browser: [`processor.ts`](src/entrypoints/background/handlers/processor.ts) calls `chrome.offscreen.createDocument()` on Chrome and falls back to appending a hidden `<iframe src="/offscreen.html">` to the background event-page's own document on Firefox. From the application's perspective the offscreen URL hosts the same page either way, so all downstream code (FFmpeg muxer, download-worker iframes, message ports) is shared.

### 7a. Chrome stream fetch - SABR and CDN fallback

On Chrome, [`download-worker/main.ts`](src/entrypoints/download-worker/main.ts) is the actual download engine. It tries two methods in order:

**SABR** ([`sabr-downloader.ts`](src/entrypoints/background/download/sabr-downloader.ts)) speaks YouTube's internal adaptive streaming protocol via [`googlevideo`](https://npm.im/googlevideo), constructing protobuf requests that the CDN accepts as a real player session. A stall timer aborts and falls back to CDN if no bytes arrive within 5 seconds, or if progress stalls for 10 seconds. Because the service worker can't set `Origin` headers (Chrome strips them), a `declarativeNetRequest` rule in [`wxt.config.ts`](wxt.config.ts) rewrites the header at the network layer on every outgoing request to `googlevideo.com`.

**CDN fallback** ([`cdn-downloader.ts`](src/entrypoints/background/download/cdn-downloader.ts)) is used when SABR stalls or isn't available - plain HTTPS fetches with byte-range support so a dropped connection resumes from where it left off rather than restarting.

As each chunk arrives the worker posts a `worker-chunk` message to the offscreen document. [`accumulator.ts`](src/entrypoints/offscreen/stream/accumulator.ts) collects and sequences the chunks. When all chunks for a stream have arrived, [`end-handler.ts`](src/entrypoints/offscreen/stream/end-handler.ts) marks the stream complete and, once both video and audio streams are finished, hands everything to the processing pipeline.

### 7b. Firefox stream fetch - `ANDROID_VR` bypass

On Firefox-on-Windows, YouTube's anti-bot infrastructure rejects SABR with `HTTP 403` or caps the response at ~60s regardless of cookies, PO token, or DNR header rewrites. The TLS fingerprint and request signature differ enough from Chrome's that the `WEB`-client SABR path is unusable. Direct progressive URLs returned by the `WEB` client also 403 from any context (extension or page). [`runFirefoxDirectDownload()`](src/entrypoints/background/download/firefox-direct-download.ts) sidesteps this by impersonating yt-dlp's [`android_vr`](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/youtube/_base.py) extractor:

1. **InnerTube call** - POST `/youtubei/v1/player` with `clientName: ANDROID_VR` (X-YouTube-Client-Name 28, Oculus Quest 3, Android 12L user agent) via [`android-player.ts`](src/lib/youtube/android-player.ts). The request body embeds `visitorData` and is sent with `credentials: "include"`. `ANDROID_VR` is the only first-party client that returns direct CDN URLs for every adaptive format without requiring a PO token, without forcing SABR, and without the 4 MB per-request range cap that the plain `ANDROID` client enforces. Both auth inputs are mandatory and complementary - empirically the InnerTube anti-bot gate validates the *value* of the `visitorData` blob (not just its presence: empty string and dummy bytes both return `LOGIN_REQUIRED: "Sign in to confirm you're not a bot"`), and cookies alone are insufficient because the `VISITOR_INFO1_LIVE` cookie is just the visitor ID while `visitorData` is a 520-byte base64-protobuf with server-generated metadata the extension can't reconstruct. The blob only exists in MAIN-world page context (`ytcfg.get("VISITOR_DATA")`), so the call structurally has to go through the page-proxy described below.

2. **Page proxy** ([`page-sabr-fetch.content.ts`](src/entrypoints/page-sabr-fetch.content.ts), [`page-proxy-fetch.ts`](src/entrypoints/background/download/page-proxy-fetch.ts)) - a MAIN-world content script that the background can invoke via `browser.tabs.sendMessage`. It performs the fetch inside an `about:blank` iframe's pristine `fetch` (YouTube wraps `window.fetch` with a Trusted-Types anti-bot wrapper that throws when invoked from extension code) so the request originates same-origin to youtube.com. Before each request it substitutes the `__YTDL_VISITOR_DATA__` placeholder in the body with `ytcfg.VISITOR_DATA`. The background tries a BG-direct fetch first as a fast path; the placeholder always fails the gate at the BG layer, so the catch unconditionally falls through to the page-proxy retry where substitution happens.

3. **Chunked download** - the resolved adaptive URLs are fetched as 10 MB closed-range chunks (matching yt-dlp's `--http-chunk-size` default) in parallel for video and audio. ANDROID_VR URLs are signature-authenticated, so chunk fetches succeed BG-direct with `credentials: "include"`; the page-proxy fallback covers the rare case of a transient block. Chunks stream to the offscreen iframe via `sendNetworkChunkToOffscreen` and flow into the same `accumulator.ts` / `end-handler.ts` pipeline Chrome uses, so muxing is identical on both browsers.

The architectural cost of the bypass is bounded: only the request-resolution and byte-fetch steps differ between Chrome and Firefox. Once chunks reach the offscreen host, the rest of the pipeline (FFmpeg muxing, blob creation, `browser.downloads.download`) runs on shared code.

### 8. Muxing - FFmpeg WASM in the browser

[`stream-processor.ts`](src/lib/download-pipeline/stream-processor.ts) receives the assembled streams and routes based on `DownloadType`:

- **Video + audio** - [`process-video-audio.ts`](src/lib/download-pipeline/process-video-audio.ts) checks whether the video codec, audio codec, and any extra tracks are natively compatible with the chosen output container. If not (e.g. an Opus track in an MP4), it either transcodes the audio or falls back to MKV. It also forces MKV when extra audio tracks are present, since MP4 and WebM carry only one audio stream. Then it drives the mux worker to merge everything into the final file.
- **Video-only or audio-only** - [`process-single-media.ts`](src/lib/download-pipeline/process-single-media.ts) saves video bytes directly with no FFmpeg pass. For audio, if source and target format match (WebM-to-WebM, M4A-to-M4A) the bytes are saved as-is; any other combination goes through FFmpeg to transcode.

The mux worker ([`mux-worker/index.ts`](src/entrypoints/mux-worker/index.ts)) runs FFmpeg compiled to WASM inside a dedicated Web Worker (the offscreen document exists precisely to host this binary - the service worker can't). It receives jobs over a `MessagePort` and merges video, all audio tracks, subtitle streams, cover art, and ID3 metadata into the final file.

For YouTube Music tracks, [`background-downloader.ts`](src/entrypoints/background/download/background-downloader.ts) first queries the YouTube Music InnerTube API to replace the standard player metadata with the canonical catalogue entry (song title, artist, album, 544x544 cover thumbnail) before the mux job runs.

### 9. Thumbnail extraction - cover art for music tracks

For YouTube Music tracks, the mux job embeds a cover art image directly into the output file. [`background-downloader.ts`](src/entrypoints/background/download/background-downloader.ts) queries the YouTube Music InnerTube API (`/youtubei/v1/search` on `music.youtube.com`) to find the canonical catalogue entry and pulls a 544x544 thumbnail URL out of `musicThumbnailRenderer`. If no match is found it falls back to the highest-resolution entry in the player config's `videoDetails.thumbnail.thumbnails`, normalising the size to `w544-h544` via a query-parameter replacement.

That URL travels into the mux worker inside `EmbedMetadataJob.thumbnailUrl`. [`mux-thumbnail.ts`](src/entrypoints/mux-worker/mux-thumbnail.ts) fetches the bytes directly (YouTube CDN URLs are CORS-permissive), preferring JPEG over WebP by swapping the `/vi_webp/` path segment to `/vi/`. [`mux-handler-embed-metadata.ts`](src/entrypoints/mux-worker/mux-handler-embed-metadata.ts) then detects the actual format from magic bytes (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF…WEBP`), writes the image to a temporary `cover.{ext}` file, and hands it to FFmpeg with `-disposition:v attached_pic`. JPEG images are stream-copied; any other format is re-encoded to MJPEG.

### 10. Progress - a single state shape fanned out via custom-event bus

As chunks arrive and FFmpeg runs, [`progress-reporter.ts`](src/lib/download-pipeline/progress-reporter.ts) emits `PipelineProgress` messages with a 0-1 value and a phase label (video fetch, audio fetch, FFmpeg mux). The message travels:

`offscreen` -> [`pipeline-handlers.ts`](src/entrypoints/background/handlers/pipeline-handlers.ts) -> tab message `UpdateDownloadProgress` -> ISOLATED content script [`background.ts`](src/entrypoints/youtube.content/handlers/background.ts)

The ISOLATED handler writes a single `DownloadProgressEntry` (`{ isDownloading, isDone, progress, progressType, isFailed? }` from [`domain-types.ts`](src/types/domain-types.ts)) into [`downloadProgressStore`](src/lib/ui/synced-stores.svelte.ts) - a `createSyncedMap`-backed store whose `set()` broadcasts a `CustomEvent` via [`defineCustomEventMessaging`](https://webext-core.aklinker1.io/messaging/). `CustomEvent`s dispatched on `window` cross the ISOLATED/MAIN world boundary inside the same document, so MAIN-world UI receives the update automatically. The watch button in [`WatchButton.state.svelte.ts`](src/entrypoints/youtube-main.content/watch-button/WatchButton.state.svelte.ts) uses Svelte 5 `$derived` to read `downloadProgressStore.get(videoId)` reactively - there is no separate progress-event bus and no setter-callback bridge.

The same shape backs three consumer surfaces:

- ISOLATED-world components (panel, playlist items, grid items) subscribe to `downloadProgressStore` directly
- The MAIN-world watch button subscribes to the same store via the cross-world CustomEvent bus
- The popup (separate document) reads [`statusProgressItem`](src/lib/storage/storage.ts) - the same `DownloadProgressEntry` shape, persisted via `chrome.storage.local` for cross-document delivery

**Per-stage weighting**: the 0-70% slice of the ring divides evenly across every component (video, primary audio, each additional audio track, each caption); 70-100% covers FFmpeg muxing. [`progress-stages.ts`](src/entrypoints/background/download/progress-stages.ts) exports the `computeWeightedProgress` formula shared by all three download paths ([`sabr-progress.ts`](src/entrypoints/background/download/sabr-progress.ts), [`cdn-progress.ts`](src/entrypoints/background/download/cdn-progress.ts), and [`firefox-direct-download.ts`](src/entrypoints/background/download/firefox-direct-download.ts)) so the layout is identical regardless of which route the download takes. Captions ship pre-fetched inside the `DownloadRequest`, so they count as instantly complete and the bar opens at `captionCount/totalStages`.

**Delivery routing inside BG**: [`progress-fetch.ts`](src/entrypoints/background/download/progress-fetch.ts) probes for tabs-API availability at runtime via `typeof document === "undefined" || browser.runtime.getURL("").startsWith("moz-extension://")` - if true (Chrome service worker, Firefox background event-page, Firefox offscreen iframe), `UpdateDownloadProgress` goes directly to the tab; otherwise (Chrome offscreen document, Chrome download-worker iframe) it routes via `ForwardProgressUpdate` to the background, which has the `tabs` API and forwards on. FFmpeg muxing progress always originates in the offscreen document and uses `PipelineProgress`, which `pipeline-handlers.ts` re-broadcasts unconditionally. No part of the chain throttles - every byte event fires immediately.

### 11. Save - triggering the browser download

[`triggerDownload()`](src/lib/download-pipeline/blob-download.ts) wraps the output bytes in a `Blob` with the correct MIME type, creates an object URL, and calls `browser.downloads.download({ url, filename })`. After the browser claims the file it revokes the object URL and writes a `RecentDownload` entry to storage for the popup history. For batch downloads, bytes accumulate into a JSZip archive that flushes to disk when the last item in the batch completes.

### Resilience

The service worker persists each `DownloadRequest` before dispatching and re-fires it on the next `online` event if the connection drops. On any other recoverable failure (HTTP 5xx, 429, network reset, stall, chunk fetch error - the regex set lives in [`network-retry.ts`](src/entrypoints/background/download/network-retry.ts)), [`scheduleAutoRetry`](src/entrypoints/background/download/network-retry.ts) re-fires the same `DownloadRequest` with exponential backoff (5s / 20s / 60s, capped at 3 attempts) without ever surfacing UI. The Retry button on the watch button is reserved for genuinely unrecoverable errors - FFmpeg muxing failure, codec or container parse errors, attestation walls that fresh PO tokens won't bypass, OPFS write failures. If the user sees Retry, the underlying problem is one a fresh attempt cannot fix on its own.

Manual cancels propagate atomically through the worker iframe, the offscreen accumulator, the FFmpeg mux queue ([`mux-queue.ts`](src/lib/download-pipeline/mux-queue.ts) clears its cancel marker on the next enqueue so a restart isn't blocked by the previous attempt's flag), and the persisted retry record - so a cancelled download is never resurrected, and a download restarted right after cancel runs cleanly without inheriting any state from the cancelled attempt.

## Contribute

### Testing on Chrome on Linux

Some bugs only surface on Linux (e.g. Chrome sandbox restrictions, different CDP behaviour). To reproduce them on Windows without a separate machine, use the included Multipass VM workflow:

**Prerequisites (one-time, elevated)**

```sh
pnpm install:hyperv-multipass
```

This enables Hyper-V and installs [Multipass](https://multipass.run). A reboot is required after the first run.

**VM setup (one-time)**

```sh
pnpm setup:linux-vm
```

Creates an Ubuntu 24.04 VM named `ytdl-linux`, mounts the repo read-only at `/host-repo` inside the VM, installs Node 22 / pnpm / bun / Chrome dependencies, and wires a `netsh portproxy` so the VM's CDP port is reachable at `localhost:9234` on Windows (used by the `chrome-devtools-mcp-linux` MCP server).

**Daily dev**

```sh
pnpm dev:linux
```

Starts the VM if needed, refreshes the port proxy, syncs the current branch into the VM, and launches `pnpm dev` under Xvfb so Chrome runs headless. A VNC server also starts so you can visually inspect the browser via any VNC viewer pointed at `localhost:5900`.

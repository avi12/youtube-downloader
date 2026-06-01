# Architecture

A guide for contributors. The README explains *what* this extension does and how to install it. This document explains *how* it's put together and which constraints shape the design — enough to find your way around the code without reading every file.

The central constraint shaping everything: MV3 fragments execution across isolated runtimes that can't share memory, and the YouTube stream protocol that actually delivers bytes (SABR) is gated by a cryptographic challenge that only the page's own JavaScript can solve. So the architecture is a relay race — page context resolves auth and URLs, the background orchestrates, the offscreen document holds the heavy runtimes (FFmpeg WASM, sandboxed download iframes), and a small handful of typed buses move state between them.

## System diagram

```mermaid
flowchart TB
    Click["User clicks Download<br/>(watch-button-click.ts)"]

    subgraph Resolve["MAIN-world resolution (parallel)"]
      direction TB
      Itags["Read itags +<br/>audio-track metadata<br/>from streamingData"]
      PO["PO Token<br/>(BotGuard interpreter +<br/>/api/jnn/v1/GenerateIT)"]
      Sig["Decipher signatureCipher<br/>(pattern-match player.js,<br/>replay swap/reverse/splice)"]
      Captions["Fresh caption URLs<br/>(InnerTube /youtubei/v1/player)<br/>+ fetch VTT blobs"]
    end

    Click --> Resolve
    Resolve --> Pack["Pack DownloadRequest"]
    Pack -->|"CustomEvent bus"| Iso["ISOLATED content"]
    Iso -->|"runtime message"| SW["Background SW / event-page"]

    SW --> Branch{"isFirefoxRuntime?"}
    Branch -->|"Chrome"| Worker["Download-worker iframe<br/>(in offscreen document)"]
    Branch -->|"Firefox"| FF["ANDROID_VR InnerTube call<br/>(BG-direct fast path,<br/>page-proxy fallback for visitorData)"]

    Worker --> SABR["1. SABR<br/>(googlevideo protobuf,<br/>5s/10s stall timer,<br/>DNR rewrites Origin)"]
    SABR -->|"empty / stall"| CDN["2. CDN byte-range GET<br/>(resumable)"]
    CDN -->|"empty / 403"| FB{"audio-only +<br/>resolvedAudioUrl?"}
    FB -->|"yes"| Direct["3. browser.downloads<br/>direct CDN URL<br/>(skips muxer)"]
    FB -->|"no"| Scrub["4. Scrub-capture iframe<br/>(hidden watch tab ytdl=1,<br/>SourceBuffer hook)"]

    FF --> FFchunk["10 MB closed-range chunks,<br/>video + audio in parallel"]

    SABR -->|"chunks"| Acc["Offscreen accumulator +<br/>end-handler"]
    CDN -->|"chunks"| Acc
    Scrub -->|"chunks"| Acc
    FFchunk -->|"chunks"| Acc

    Acc --> Mux["FFmpeg WASM mux worker<br/>(video + audio tracks +<br/>VTT subtitles + cover art +<br/>ID3 metadata)"]
    Mux --> Blob["Output blob"]
    Blob --> DL["browser.downloads.download"]
    Direct --> DL
```

Chrome and Firefox diverge only at `isFirefoxRuntime?`. Everything that runs in MAIN context before the dispatch (auth, itags, captions) and everything after the chunks reach the accumulator (muxing, blob creation, `browser.downloads`) is shared code. The two sequence diagrams further down zoom into the Chrome 4-layer fallback chain and the Firefox page-proxy hand-off.

## Codemap

Each top-level directory under `src/` owns one layer of the relay.

| Path | Role |
| --- | --- |
| `src/entrypoints/youtube-main.content/` | MAIN-world content scripts. Reads Polymer state, builds the `DownloadRequest`, runs BotGuard / generates PO tokens, watches player events. |
| `src/entrypoints/youtube.content/` | ISOLATED-world content. Bridges page-context messages to `browser.runtime`. |
| `src/entrypoints/page-sabr-fetch.content.ts` | MAIN-world bridge that runs page-context pristine `fetch` for the Firefox InnerTube path. |
| `src/entrypoints/sourcebuffer-capture/` | MAIN-world script that patches `SourceBuffer.appendBuffer` on the scrub-capture iframe to siphon decoded segments. |
| `src/entrypoints/background/` | Dispatcher, download orchestration, fallback chain, retry / queue / tab-tracking, progress routing. |
| `src/entrypoints/offscreen/` | Offscreen document. Hosts FFmpeg WASM (which the SW can't run), the download-worker iframe, and the scrub-capture iframe. On Firefox the offscreen "document" is a hidden iframe in the BG event-page's own document, but the URL is the same. |
| `src/entrypoints/download-worker/` | Sandboxed iframe inside the offscreen document. Runs Chrome's SABR + CDN fetch loop in isolation from the BG SW. |
| `src/entrypoints/mux-worker/` | Web Worker that drives `@ffmpeg/core` to mux video + audio + subtitles + cover art. |
| `src/entrypoints/popup/` | Browser-action popup. Download history (IndexedDB + blob store), live progress, format-change dialog, settings. |
| `src/lib/youtube/` | YouTube-specific knowledge: Innertube schemas, SABR protocol, BotGuard / PO token, format helpers, signature decryptor. |
| `src/lib/messaging/` | Typed buses: cross-world (MAIN ↔ ISOLATED via `CustomEvent`), runtime (content ↔ BG), offscreen (BG ↔ offscreen via `MessagePort`), window (page ↔ extension via `window.postMessage`). |
| `src/lib/download-pipeline/` | Browser-agnostic post-fetch pipeline: stream processor, mux job builder, FFmpeg instance, blob download, recent-downloads store. |
| `src/lib/storage/` | `wxt/storage`-backed items with per-item mutation locks. |
| `src/lib/ui/` | Svelte 5 stores and reactive helpers shared across content scripts and popup. |
| `src/components/` | Svelte 5 components. |
| `wxt.config.ts` | Manifest emission, including the DNR rule that rewrites `Origin: youtube.com` on outgoing `googlevideo.com` requests (the SW can't set it itself). |

## Architectural invariants

These are the rules the rest of the code relies on. Many are "absence of something" and impossible to recover from reading source alone, which is why they live here.

- **MAIN world resolves, background fetches.** Every piece of YouTube state (itags, SABR config, PO token, fresh caption URLs, dubbing tracks) is gathered in the MAIN-world content script and packed into a single `DownloadRequest` *before* any cross-context message is sent. The background never reads page state.
- **The background SW never touches stream bytes on Chrome.** All network I/O for streams happens inside the download-worker iframe or the scrub-capture iframe. The SW only orchestrates.
- **One `DownloadProgressEntry` shape across every surface.** Watch button (MAIN), in-tab UI (ISOLATED), and popup (separate document) all read the same shape — the first two from a cross-world `CustomEvent` store, the popup from `chrome.storage.local`.
- **One browser-discriminator function, used everywhere.** `isFirefoxRuntime()` probes `typeof browser.offscreen === "undefined"`. There are no per-feature browser checks.
- **The offscreen "document" is the same page on both browsers.** Chrome uses `chrome.offscreen.createDocument()`; Firefox appends a hidden iframe with the same URL into the BG event-page's own document. Everything downstream is shared code.
- **`Origin: youtube.com` comes back via the network layer, not via code.** The DNR rule rewrites the header on every outbound `googlevideo.com` request. No callsite has to remember to set it.
- **The Firefox InnerTube call must originate from the page.** The `visitorData` blob YouTube validates only exists in `ytcfg`; pulling it from extension context fails the anti-bot gate. The page-proxy bridge runs the fetch from a MAIN-world iframe so the request appears same-origin.
- **403 is terminal; 5xx and 429 are transient.** Auto-retry fires only for the transient set. Retrying a 403 just wastes the retry budget.
- **Manual cancels propagate to every level atomically.** Worker iframe abort, offscreen accumulator drop, mux queue cancel marker, persisted-retry deletion — all keyed off the same `videoId`. A cancelled download is never resurrected by a stale retry.
- **The Retry button is for unrecoverable errors only.** Auto-retry handles 5xx / 429 / network reset / stall silently (5 s / 20 s / 60 s backoff, 3 attempts). If the user sees Retry, the failure is a class that a fresh attempt can't fix on its own — FFmpeg mux failure, codec parse error, attestation wall, OPFS write error.

## Deep dives

These three sections are the parts of the system that are most non-obvious and most worth understanding before changing code.

### Chrome stream fetch — four-layer fallback chain

```mermaid
sequenceDiagram
    participant W as Download-worker iframe
    participant CDN as YouTube CDN
    participant BG as Background
    participant DL as browser.downloads

    W->>CDN: 1. SABR (protobuf via googlevideo)
    Note over W,CDN: stall timer aborts if no bytes in 5s<br/>or progress stalls for 10s
    CDN--xW: empty / stalled
    W->>CDN: 2. CDN byte-range GET
    CDN--xW: empty / 403
    alt audio-only with resolvedAudioUrl
      W-)BG: worker-needs-direct-url
      BG->>DL: 3. browser.downloads.download(audioUrl)
    else any other case
      W-)BG: worker-needs-fallback
      BG->>BG: 4. open hidden watch-page iframe (ytdl=1)
      Note right of BG: SourceBuffer hook siphons segments<br/>as YouTube's player decodes them
    end
```

The Chrome path walks four layers, each only invoked when the one above returns no usable bytes.

1. **SABR.** YouTube's internal adaptive streaming protocol, spoken via `googlevideo`. The download-worker iframe constructs protobuf requests the CDN accepts as a real player session. A stall timer aborts and yields to layer 2 if no bytes arrive within 5 s, or progress stalls for 10 s.
2. **CDN.** Plain HTTPS byte-range fetches against the resolved adaptive URL. A dropped connection resumes from the offset rather than restarting.
3. **Direct CDN URL via `browser.downloads`.** Audio-only path only. If the worker has a `resolvedAudioUrl`, it hands the URL straight to `browser.downloads.download` and skips muxing. If even this fails (transient block, expired signature), it falls through to layer 4.
4. **Watch-page scrub-capture.** Last resort. The background opens a hidden `<iframe src="youtube.com/watch?v={id}&ytdl=1&mute=1&autoplay=1">` inside the offscreen document. A MAIN-world content script patches `MediaSource.addSourceBuffer` and `SourceBuffer.appendBuffer` to siphon every video and audio segment as YouTube's own player decodes the stream into its media element. Up to two fresh-iframe retries before reporting failure.

Captured bytes from every layer flow into the same offscreen accumulator, so muxing is identical regardless of which layer produced them.

### Firefox stream fetch — `ANDROID_VR` bypass

```mermaid
sequenceDiagram
    participant BG as Background
    participant Tab as MAIN-world page-proxy
    participant YT as youtubei API
    participant CDN as YouTube CDN

    BG->>YT: InnerTube POST (ANDROID_VR, placeholder visitorData) [fast path]
    YT--xBG: LOGIN_REQUIRED (anti-bot)
    BG->>Tab: pageSabrFetch (with __YTDL_VISITOR_DATA__ placeholder)
    Tab->>YT: POST from page context<br/>(real ytcfg.VISITOR_DATA substituted)
    YT-->>Tab: adaptive stream URLs
    Tab-->>BG: stream URLs
    par video chunks
      BG->>CDN: GET Range bytes=0-10MB
      CDN-->>BG: chunk
    and audio chunks
      BG->>CDN: GET Range bytes=0-10MB
      CDN-->>BG: chunk
    end
```

On Firefox-on-Windows, YouTube's anti-bot infrastructure rejects SABR (HTTP 403 or ~60 s response cap) regardless of cookies, PO token, or DNR rewrites. The TLS fingerprint and request signature differ enough from Chrome's that the `WEB`-client SABR path is unusable, and direct progressive URLs returned by the `WEB` client also 403 from any context.

The bypass mirrors yt-dlp's `android_vr` extractor:

1. **InnerTube call.** `POST /youtubei/v1/player` with `clientName: ANDROID_VR` (X-YouTube-Client-Name 28, Oculus Quest 3, Android 12L user agent). `ANDROID_VR` is the only first-party client that returns direct CDN URLs for every adaptive format without forcing SABR, without requiring a PO token, and without the 4 MB per-request range cap that the plain `ANDROID` client enforces.
2. **Page-proxy auth.** The InnerTube anti-bot gate validates the *value* of the `visitorData` blob, not just its presence — empty string and dummy bytes both return `LOGIN_REQUIRED`. The blob is a 520-byte base64-protobuf with server-generated metadata the extension can't reconstruct, and only exists in MAIN-world page context (`ytcfg.get("VISITOR_DATA")`). So the call has to go through a page-proxy bridge: the background sends a `pageSabrFetch` message to a MAIN-world iframe, which substitutes a `__YTDL_VISITOR_DATA__` placeholder in the request body and runs the fetch from page context. A BG-direct fast path is tried first and falls through to the page-proxy on failure.
3. **Chunked download.** The resolved adaptive URLs are fetched as 10 MB closed-range chunks (matching yt-dlp's `--http-chunk-size` default) in parallel for video and audio. ANDROID_VR URLs are signature-authenticated so chunk fetches succeed BG-direct with `credentials: "include"`; the page-proxy fallback covers the rare case of a transient block.

Chunks stream to the offscreen iframe and join the same accumulator → end-handler → FFmpeg pipeline Chrome uses.

### Cross-world progress propagation

Progress crosses three boundaries — offscreen → BG → tab → MAIN-world UI — and lands as the same `DownloadProgressEntry` object on every consumer.

Inside the BG, the dispatcher in `progress-fetch.ts` decides whether to message the tab directly or route via the SW. The probe: *direct dispatch is possible from any context that owns the tabs API* — Chrome service worker (no `document`), Firefox event-page, Firefox offscreen iframe. The Chrome offscreen document and Chrome download-worker iframe lack `chrome.tabs` and must route via `ForwardProgressUpdate` to the SW, which writes `statusProgressItem` to storage and forwards to the tab. Same end state on both browsers; different number of hops.

Updates are coalesced per `videoId` at 100 ms. Without coalescing, per-chunk emit rates starve the watch tab's hover and tooltip events. The coalesce also smooths out the byte readout (`downloadedBytes` / `totalBytes` / `bytesPerSecond`, the last computed from a 2-second sliding window) that the popup shows.

The ISOLATED content handler writes the `DownloadProgressEntry` into `downloadProgressStore`, a `createSyncedMap` whose `set()` dispatches a `CustomEvent` on `window`. `CustomEvent`s on `window` cross the MAIN/ISOLATED boundary inside the same document, so the watch button (MAIN world, Svelte 5 `$derived`) receives updates without any explicit bridge. The popup, which lives in a different document, reads the same shape from `chrome.storage.local` via `statusProgressItem`.

Per-stage weighting: the 0–70 % slice divides evenly across every component being fetched (video, primary audio, each additional audio track, each caption); 70–100 % covers FFmpeg muxing. The weighting formula lives in one place and is shared across SABR, CDN, and the Firefox direct path so the ring layout is identical regardless of route. Captions ship pre-fetched inside the `DownloadRequest` so they count as instantly complete; the bar opens at `captionCount/totalStages`.

## Cross-cutting concerns

### Resilience

- **Persist before dispatch.** Every `DownloadRequest` is written to storage before the SW dispatches it, and re-fired on the next `online` event if the connection dropped mid-flight.
- **Recoverable-error classification.** A regex set in `network-retry.ts` matches HTTP 5xx, 429, network reset, stall, and chunk fetch error. These trigger silent auto-retry with exponential backoff (5 s / 20 s / 60 s, capped at 3 attempts).
- **Unrecoverable errors surface as Retry.** FFmpeg mux failure, codec / container parse error, attestation wall that fresh PO tokens don't unblock, OPFS write error.

### Cancellation

A user cancel propagates atomically through every layer that could otherwise resurrect the download:

- The download-worker iframe's `AbortController` aborts in-flight fetches.
- The offscreen accumulator drops queued chunks for the cancelled `videoId`.
- The FFmpeg mux queue clears its cancel marker on the next enqueue, so restarting right after cancel runs cleanly without inheriting the previous attempt's flag.
- The persisted retry record is deleted.

A download restarted immediately after cancel runs from scratch with no state inherited from the cancelled attempt.

## When to update this document

Revisit when an *architectural invariant* changes — a new browser branch, a new context boundary, a new top-level directory, a new authentication flow. Don't update it for changes to specific timeouts, message names, file paths, or retry counts; those will go stale faster than you can document them.

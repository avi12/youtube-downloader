# Architecture

A high-level map of the codebase for new contributors. Read this before touching any cross-cutting code.

## The big picture

This is a Manifest V3 browser extension with four runtimes (each lives in `src/entrypoints/`):

| Runtime                    | Folder                          | World     | Lifetime              | What it does                                                                                          |
|----------------------------|---------------------------------|-----------|-----------------------|-------------------------------------------------------------------------------------------------------|
| Service worker             | `background/`                   | -         | Browser-managed       | Owns downloads, network requests, declarativeNetRequest rules, tab tracking, IndexedDB persistence.   |
| Watch-page MAIN-world script | `youtube-main.content/`       | MAIN      | Per YouTube tab/frame | Reads YouTube's Polymer state (player config, video metadata) and injects the download button.        |
| Watch-page ISOLATED-world script | `youtube.content/`        | ISOLATED  | Per YouTube tab       | UI bridge between the MAIN-world script and the service worker; renders Svelte components into the page. |
| Offscreen document         | `offscreen/`                    | -         | On-demand             | Runs FFmpeg WASM to mux video + audio (SW can't run WASM streams reliably).                           |
| Popup                      | `popup/`                        | -         | Open while popup shown | Download manager UI.                                                                                  |

There's also a small browser-action `popup/` (the toolbar button UI) and `visibility-spoof.content.ts` / `sourcebuffer-capture.content.ts` for narrower MAIN-world tasks.

## The download flow (watch page, single video)

1. User clicks the injected button on a watch page  
   → `youtube-main.content/watch-button/watch-button.ts` handles the click and calls `performDownload(...)`.
2. `youtube-main.content/video/download.ts` builds a `DownloadRequest` and posts it across worlds via `crossWorldMessenger`.
3. `youtube.content/index.ts` forwards the request to the service worker as a `StartBackgroundDownload` message.
4. `background/handlers/download-handlers.ts` enqueues it and calls `startBackgroundDownload(...)`.
5. `background/download/background-downloader.ts` invokes `attemptSabrDownload(...)` (SABR via `googlevideo` library); if SABR fails, falls back to `downloadViaCdn(...)`.
6. Resulting bytes are streamed to the offscreen doc via `dispatchToOffscreen(...)`.
7. `offscreen/stream/end-handler.ts` accumulates the chunks, feeds them to the FFmpeg pipeline (`lib/download-pipeline/`), and produces the final muxed file.
8. `lib/download-pipeline/index.ts` calls `triggerDownload(...)`, which posts a `PipelineDownload` message back to the SW with a blob URL.
9. `background/recent/recent-download-handler.ts` receives the message and calls `browser.downloads.download(...)` to actually save the file to disk.

## Shared modules (`src/lib/`)

| Folder              | Responsibility                                                        |
|---------------------|-----------------------------------------------------------------------|
| `download-pipeline/`| FFmpeg job runner, mux jobs, transcode, ZIP bundling.                 |
| `messaging/`        | Strongly-typed cross-context messaging (webext-core + cross-world).   |
| `storage/`          | Wrappers around `browser.storage` and IndexedDB (`recent-downloads-db`). |
| `youtube/`          | YouTube-specific logic: PO token, SABR, signature, metadata extraction. |
| `ui/`               | Cross-component UI helpers (Polymer-attaching, playlist selection state). |
| `utils/`            | DOM helpers, binary/base64, container/MIME helpers, stream helpers.    |

## Components (`src/components/`)

Svelte 5 components shared across content scripts and popup. Use **only** YouTube's Polymer CSS variables (`--yt-spec-*`) for colors, fonts, and spacing — never hardcode colors. This keeps light/dark theme support automatic.

## Cross-context messaging cheat sheet

- **MAIN ↔ ISOLATED**: `crossWorldMessenger` (CustomEvent-based, see `lib/messaging/cross-world-messenger.ts`).
- **Content script ↔ SW**: `sendMessage` / `onMessage` from `lib/messaging/messaging.ts` (webext-core).
- **SW ↔ Offscreen doc**: `lib/messaging/offscreen-messaging.ts`.

## Key conventions

- Naming: `camelCase` for vars/functions, `SCREAMING_SNAKE_CASE` for module constants. Element refs are `elFoo`, indices `iFoo`, booleans `isFoo`.
- No premature abstractions. No comments unless the *why* is non-obvious.
- See `CLAUDE.md` for the full code-style rulebook.

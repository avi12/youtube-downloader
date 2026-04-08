# Synced Signals: Cross-World Reactive State

## Problem

The extension has two JavaScript worlds that need shared state:
- **MAIN world** (`youtube-main.content`): accesses YouTube runtime, fetches video data, runs SabrStream
- **Isolated world** (`youtube.content` + Svelte components): renders UI, manages downloads

Current communication is a patchwork:
- `crossWorldMessenger` (`@webext-core/messaging/page`) - one listener per message type, breaks with multiple components
- DOM events (`ytdl:video-data-received`, `ytdl:progress-update`) - only work within same world
- DOM elements (`#ytdl-sabr-credentials`, `#ytdl-interrupted`) - fragile hacks for cross-world data
- Manual `refreshDownloadButton()` calls - imperative, error-prone

## Solution

A `createSyncedSignal(key, initialValue)` primitive that:
1. Returns a Svelte 5 `$state`-backed object with `.value` getter/setter
2. Writing `.value` in either world sends `window.postMessage({ ns: "ytdl-sync", key, value })`
3. Both worlds listen on `window.addEventListener("message")` and update local `$state`
4. Svelte components use `$derived` / `$effect` to react automatically
5. Works on Chrome MV3 and Firefox MV3 (128+)

## Architecture

```
MAIN world                              Isolated world
┌──────────────────────┐                ┌──────────────────────┐
│ videoDataSignal      │  postMessage → │ videoDataSignal      │
│   .set(videoId, data)│───────────────→│   .get(videoId)      │
│                      │                │   → $derived in UI   │
│                      │                │                      │
│ sabrCredentials      │  postMessage → │ sabrCredentials      │
│   .value = {url,tok} │───────────────→│   .value             │
│                      │                │   → $derived         │
│                      │                │                      │
│ downloadProgress     │  ← postMessage │ downloadProgress     │
│   .get(videoId)      │←───────────────│   .set(videoId, p)   │
│   → button refresh   │                │   (from background)  │
└──────────────────────┘                └──────────────────────┘
```

## API Design

### `createSyncedSignal<T>(key: string, initial: T)`
Single-value signal. For SABR credentials, interrupted download config.

```ts
// shared module imported by both worlds
export const sabrCredentials = createSyncedSignal<SabrCredentials | null>("sabr-creds", null);

// MAIN world writes
sabrCredentials.value = { url, poToken };

// Isolated world reads reactively
$effect(() => {
  if (sabrCredentials.value) {
    console.log("PO token received");
  }
});
```

### `createSyncedMap<T>(key: string)`
Map-based signal. For video data cache, download progress per video.

```ts
// shared module
export const videoDataStore = createSyncedMap<VideoData>("video-data");
export const downloadProgress = createSyncedMap<DownloadState>("dl-progress");

// MAIN world writes
videoDataStore.set(videoId, videoData);

// Isolated world reads reactively
const data = $derived(videoDataStore.get(videoId));
```

## Implementation (`src/lib/synced-signal.ts`)

~60 lines total:

```ts
const NAMESPACE = "ytdl-sync";

// Listen for incoming sync messages (both worlds do this)
const listeners = new Map<string, Set<(value: unknown) => void>>();

addEventListener("message", (e: MessageEvent) => {
  if (e.data?.ns !== NAMESPACE) return;
  const callbacks = listeners.get(e.data.key);
  if (!callbacks) return;
  for (const cb of callbacks) cb(e.data.value);
});

function broadcast(key: string, value: unknown) {
  postMessage({ ns: NAMESPACE, key, value }, "*");
}

function subscribe(key: string, callback: (value: unknown) => void) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(callback);
  return () => listeners.get(key)?.delete(callback);
}
```

The `createSyncedSignal` and `createSyncedMap` wrappers use `$state` internally
and call `broadcast`/`subscribe` to sync.

## What Gets Replaced

| Current hack | Replaced by |
|---|---|
| `crossWorldMessenger("videoData")` + `ytdl:video-data-received` DOM event | `videoDataStore.set(id, data)` |
| `crossWorldMessenger("requestVideoData")` + sequential queue | `videoDataStore.request(id)` + MAIN world observer |
| `#ytdl-sabr-credentials` DOM element + MutationObserver | `sabrCredentials.value = {...}` |
| `#ytdl-interrupted` DOM element | `interruptedDownloads.set(id, config)` |
| `crossWorldMessenger("progress")` + `ytdl:progress-update` DOM event | `downloadProgress.set(id, state)` |
| `crossWorldMessenger("panelClosed")` + `ytdl:panel-closed` DOM event | `panelState.value = { isOpen: false }` |
| `crossWorldMessenger("downloadRequest")` | Keep - one-shot command, not state |
| `crossWorldMessenger("cancelDownload")` | Keep - one-shot command, not state |
| `crossWorldMessenger("navigation")` | Keep - one-shot event, not state |
| Manual `refreshDownloadButton()` | `$effect` watching `downloadProgress` |

## What Stays

- `crossWorldMessenger` for **commands** (downloadRequest, cancelDownload, navigation, panelContentReady) - these are one-shot actions, not state
- `@webext-core/messaging` for background <-> content script (different transport)
- `download-state.ts` SvelteMap - merges into `downloadProgress` synced map

## Migration Order

1. Implement `synced-signal.ts` with `createSyncedSignal` and `createSyncedMap`
2. Replace SABR credentials (`#ytdl-sabr-credentials` → `sabrCredentials` signal)
3. Replace video data (`crossWorldMessenger("videoData")` → `videoDataStore` map)
4. Replace progress updates (`ytdl:progress-update` → `downloadProgress` map)
5. Replace interrupted downloads (`#ytdl-interrupted` → `interruptedDownloads` map)
6. Remove `download-state.ts` (merged into synced map)
7. Remove DOM element hacks and DOM event dispatches
8. Remove `sabr-credentials.ts` (replaced by signal)
9. Clean up unused `crossWorldMessenger` message types

## Testing

- Chrome MV3: postMessage works between MAIN/isolated worlds
- Firefox MV3 (128+): postMessage works identically
- Multiple components observing same signal update simultaneously
- MAIN world writes, all isolated world Svelte components react
- Browser navigation (SPA): signals persist within page lifecycle
- Extension reload: signals reset (expected, same as current behavior)
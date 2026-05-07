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
</p>

Chrome, Edge, Opera, and Opera GX (all MV3).

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

The dev server builds for production (with source maps), launches Chrome with the extension sideloaded, and reloads
both the extension and any open YouTube tabs on every file change under `src/`.

### Other dev commands

```bash
pnpm dev                  # WXT dev mode
pnpm dev:with-profile     # WXT dev mode with your Chrome profile
pnpm build                # Production build
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

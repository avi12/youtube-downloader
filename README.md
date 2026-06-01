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

## Architecture

How it works — system diagram, codemap, invariants, the Chrome 4-layer fallback chain, the Firefox `ANDROID_VR` bypass, and cross-world progress propagation — lives in [ARCHITECTURE.md](ARCHITECTURE.md).

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

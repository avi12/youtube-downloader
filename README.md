# YouTube Downloader

An MV3 browser extension that reverse-engineers YouTube's internal streaming infrastructure to download videos, playlists, and subscriptions - with full format control, multi-track audio, embedded subtitles, and a live download manager. Runs on Chromium and Firefox.

Built by [Avi](https://avi12.com) with supervised [Claude Code](https://claude.com/product/claude-code)

<p>
  <img src="https://user-images.githubusercontent.com/6422804/135838451-1c3ac8f1-409f-4aec-972f-1d077c05f1ea.png" height="30" alt="Google Chrome">
  <img src="https://user-images.githubusercontent.com/6422804/135838702-e852bb47-8c0d-4275-baf1-8adc1c50a3c1.png" height="30" alt="Microsoft Edge">
  <img src="https://user-images.githubusercontent.com/6422804/135838972-113f73a3-6a04-48a9-ae04-754f25bc6eb0.png" height="30" alt="Opera">
  <img src="https://upload.wikimedia.org/wikipedia/commons/e/e7/Opera_GX_Icon.svg?utm_source=commons.wikimedia.org&utm_campaign=index&utm_content=original" height="30" alt="Opera GX">
  <img src="https://upload.wikimedia.org/wikipedia/commons/9/9d/Brave_lion_icon.svg" height="30" alt="Brave">
  <img src="https://upload.wikimedia.org/wikipedia/commons/e/e4/Vivaldi_web_browser_logo.svg" height="30" alt="Vivaldi">
  <img src="https://upload.wikimedia.org/wikipedia/commons/a/a0/Firefox_logo%2C_2019.svg" height="30" alt="Firefox">
</p>

## Installation

Open the [Releases page](https://github.com/avi12/youtube-downloader/releases) and download the latest file for your browser.

**Chrome / Edge / Opera / Brave / Vivaldi**

1. Download the `youtube-downloader-*-chrome.crx` file
2. Open `chrome://extensions` (or `edge://extensions`, `opera://extensions`)
3. Turn on **Developer mode** with the toggle in the top-right corner
4. Drag the downloaded `.crx` file onto the page and confirm

**Firefox**

1. In Firefox, click the `youtube-downloader-*-firefox.xpi` link on the Releases page
2. Confirm the install when Firefox asks

That's it - the extension stays up to date on its own.

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

The Firefox bypass (routing player requests through the `ANDROID_VR` InnerTube client to get direct CDN URLs) was reverse-engineered by reading [yt-dlp](https://github.com/yt-dlp/yt-dlp)'s YouTube extractor — credit to that project for documenting the InnerTube client matrix.

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

# YouTube Downloader

An MV3 browser extension that reverse-engineers YouTube's internal streaming infrastructure to download videos, playlists, and subscriptions - with full format control, multi-track audio, embedded subtitles, and a live download manager. Runs on Chromium and Firefox.

Built by [Avi](https://avi12.com) with supervised [Claude Code](https://claude.com/product/claude-code)

<p>
  <img src="https://user-images.githubusercontent.com/6422804/135838451-1c3ac8f1-409f-4aec-972f-1d077c05f1ea.png" width="30" alt="Google Chrome">
  <img src="https://user-images.githubusercontent.com/6422804/135838702-e852bb47-8c0d-4275-baf1-8adc1c50a3c1.png" width="30" alt="Microsoft Edge">
  <img src="https://user-images.githubusercontent.com/6422804/135838972-113f73a3-6a04-48a9-ae04-754f25bc6eb0.png" width="30" alt="Opera">
  <img src="https://upload.wikimedia.org/wikipedia/commons/e/e7/Opera_GX_Icon.svg?utm_source=commons.wikimedia.org&utm_campaign=index&utm_content=original" width="30" alt="Opera GX">
  <img src="https://upload.wikimedia.org/wikipedia/commons/9/9d/Brave_lion_icon.svg" width="30" alt="Brave">
  <img src="https://upload.wikimedia.org/wikipedia/commons/e/e4/Vivaldi_web_browser_logo.svg" width="30" alt="Vivaldi">
  <img src="https://upload.wikimedia.org/wikipedia/commons/a/a0/Firefox_logo%2C_2019.svg" width="30" alt="Firefox">
</p>

## Installation

Grab the latest signed package for your browser from the [Releases page](https://github.com/avi12/youtube-downloader/releases). Both formats persist across browser restarts and auto-update from this repo's GitHub Pages on every poll.

**Chromium (Chrome / Edge / Opera / Opera GX / Brave / Vivaldi)** - `youtube-downloader-*-chrome.crx`
1. Go to `chrome://extensions` (or `edge://extensions`, `opera://extensions`, etc.)
2. Enable **Developer mode** (top-right toggle)
3. Drag and drop the `.crx` onto the page

**Firefox** - `youtube-downloader-*-firefox.xpi`
1. Right-click the `.xpi` download link on the Releases page -> **Save Link As...** is not needed
2. Just click the `.xpi` link directly in Firefox; the browser prompts to install it
3. Confirm the install

Sideloaded `.zip`s are still attached to each release for development purposes (unsigned, no auto-update); they require Developer Mode + manifest.json drag-drop and don't persist across Firefox restarts. Prefer the `.crx` / `.xpi` for actual use.

## Auto-update (self-hosted)

The extension carries an `update_url` for both browsers and bypasses the Chrome Web Store / Mozilla AMO public listings. Update manifests live at:

- Chrome: <https://avi12.github.io/youtube-downloader/updates.xml>
- Firefox: <https://avi12.github.io/youtube-downloader/updates.json>

Both files are committed under `docs/` and served by GitHub Pages (Settings -> Pages -> source `main /docs`). On each release, the browser polls these URLs and downloads the new artifact from GitHub Releases automatically.

### One-time setup

```sh
pnpm keygen:chrome
```

Generates `keys/chrome.pem` (gitignored) and prints:

- `CHROME_EXTENSION_KEY` — base64 DER public key, pins the Chrome extension ID across packed and unpacked installs. Must be set whenever you `pnpm build`/`pnpm pack` for Chrome.
- `CHROME_CRX_PRIVATE_KEY_PATH` — path to the PEM, used by `pnpm release` to pack the signed `.crx`.

Store both in your shell profile or a CI secret store. Losing the PEM means existing installs can never be auto-updated again.

For Firefox, submit the first `.zip` to [AMO as "On your own"](https://addons.mozilla.org/developers/addon/submit/distribution) (unlisted self-distribution). Mozilla signs the `.xpi` without listing it publicly; download the signed file and use it as the release artifact.

### Cutting a release

1. Bump `version` in `package.json`.
2. `$env:CHROME_EXTENSION_KEY = "..."; $env:CHROME_CRX_PRIVATE_KEY_PATH = "..."`.
3. `pnpm build:pack && pnpm build:pack:firefox` — produces `.output/*-chrome.zip`, `.output/*-firefox.zip`, plus a Firefox `.zip` to upload to AMO for signing.
4. `pnpm release` — regenerates `docs/updates.xml` + `docs/updates.json` for the new version and packs `.output/chrome-mv3.crx`.
5. Upload to a GitHub Release tagged `vX.Y.Z`:
   - `youtube-downloader-X.Y.Z-chrome.crx`
   - `youtube-downloader-X.Y.Z-firefox.xpi` (the AMO-signed one)
   - Original `.zip` artifacts for first-time sideloads
6. Commit and push `docs/updates.xml` + `docs/updates.json`.

Chrome polls `update_url` roughly every 5 hours; users can force a check at `chrome://extensions` -> Developer mode -> Update. Firefox polls every 24 hours and exposes "Check for Updates" in `about:addons`.

### Chrome sideload caveat

Stable Chrome on Windows/macOS blocks installing externally hosted `.crx` files by default. Three working install paths:

- Developer Mode + drag-and-drop the `.crx` (per-machine).
- Enterprise: deploy `ExtensionInstallForcelist` via group policy with `<extensionId>;<update_url>`. Chrome then installs and auto-updates silently.
- Chromium forks (Brave, Vivaldi, Opera) with looser sideload policies.

Once the extension is installed by any of these methods, the `update_url` auto-update path is identical and runs unattended.

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

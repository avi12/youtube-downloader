# Forked Firefox for YTDL dev

Why: web-ext-run launches Firefox with `--marionette --remote-debugging-port=...`
so MCP and the auto-reloader can attach. That leaves at least two
JS-detectable automation signals in the Gecko binary — `Navigator::WebDriver()`
and the Remote Agent's presence — which YouTube's SABR/player-endpoint
anti-bot uses to gate requests (every client we've tried lands on
`LOGIN_REQUIRED: Sign in to confirm you're not a bot`).

Regular Firefox on the same machine, same profile, same cookies, handles
YouTube fine. So the fix isn't at the extension layer — it's at the
browser binary layer. This folder is where we fork Gecko, patch the
automation signals out, and build a binary that behaves identically to
regular Firefox from YouTube's perspective but still exposes marionette
and RDP for our dev tooling.

## Output

The build places the patched Firefox at:

    user-profiles/firefox-patched/firefox.exe   (Windows)
    user-profiles/firefox-patched/firefox       (macOS/Linux)

`scripts/dev-server.ts::findFirefox()` prefers this binary over the system
Firefox when it exists, so running `pnpm dev:stable-firefox` automatically
picks up the fork once built.

## Build (Windows, first time)

Full build: ~1–6 hours. Source tree: ~4 GB. Object dir: ~30 GB. Only do
this once per Firefox release we want to target.

Prereqs — install via `mozilla-build` bootstrap:

1. Install [MozillaBuild](https://ftp.mozilla.org/pub/mozilla/libraries/win32/MozillaBuildSetup-Latest.exe).
2. Open `C:\mozilla-build\start-shell.bat`.
3. `mkdir -p /c/mozilla-source && cd /c/mozilla-source`.
4. `git clone https://github.com/mozilla-firefox/firefox.git gecko-dev`
   (or `hg clone https://hg.mozilla.org/mozilla-unified mozilla-unified`
   if you prefer Mercurial).
5. `cd gecko-dev && git checkout FIREFOX_149_0_2_RELEASE` (or whatever release matches system Firefox — check `about:support`).
6. `./mach bootstrap` — pick "1. Firefox for Desktop", let it install Rust/clang/etc.

Apply our patches and build:

    cd /c/mozilla-source/gecko-dev
    for p in /c/repositories/avi/youtube-downloader/scripts/firefox-fork/patches/*.patch; do
      git apply "$p"
    done
    ./mach build

Copy the result to `user-profiles/firefox-patched/`:

    cp -r obj-x86_64-pc-windows-msvc/dist/bin/* \
      /c/repositories/avi/youtube-downloader/user-profiles/firefox-patched/

Verify:

    cd /c/repositories/avi/youtube-downloader
    pnpm dev:stable-firefox
    # dev-server should log: "Using patched Firefox: user-profiles/firefox-patched/firefox.exe"

## Incremental rebuild after patch edits

    ./mach build binaries

Usually a few minutes.

## Keeping up with Firefox updates

Each Firefox release may reshuffle the files we patch. On update:
1. `git fetch && git checkout FIREFOX_<new-version>_RELEASE`
2. `git apply --3way patches/*.patch` — resolve conflicts
3. `./mach build`
4. Re-copy to `user-profiles/firefox-patched/`

## Patches

See [`patches/README.md`](patches/README.md) for what each patch does and
what JS-visible behavior it changes.

## If all else fails

The patched-Gecko path is heavy. Lighter alternatives if this doesn't
pan out:

- **LibreWolf / Waterfox** — third-party Firefox forks with some
  anti-fingerprinting built in. Swap the binary under `user-profiles/firefox-patched/`,
  skip the build. May not cover all the signals we need.
- **Drop marionette, use BiDi sideload** — requires replacing
  firefox-devtools-mcp with a BiDi-capable MCP and rewriting the
  web-ext-run flow. See `docs/firefox-bidi-sideload.md` (not written yet).
- **External tool** — shell out to yt-dlp via native messaging for
  Firefox downloads. Different architecture.

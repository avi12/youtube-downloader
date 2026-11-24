# Scripts

Build / dev / debugging utilities. Two categories:

## Contributor scripts

These are wired into `package.json` and are the ones you'll actually run.

| Script | Invoked by | Purpose |
| --- | --- | --- |
| `dev/server/main.ts` | `pnpm dev`, `pnpm dev:firefox` | Watches `src/` (through the Rust sidecar in `dev-server/`), rebuilds via WXT, launches one Chrome or Firefox instance with the extension installed, and on save applies the smallest update: hot-swaps popup and content-script components with their state, restarts the background in place, refreshes open extension pages, and reloads the extension (re-injecting the content scripts in place) only when nothing else works; only a MAIN-world script change reloads the tabs. `--cdp-port`, `--marionette-port`, `--profile-dir`, `--out-dir`, `--start-url`, `--mute-audio` (or `YTDL_DEV_*` env vars) run a second instance side by side. |
| `ytdl release linux-vm install-prerequisites` | `pnpm install:hyperv-multipass` | One-time Windows setup: enables Hyper-V and installs Multipass. Relaunches itself elevated. Required only if you want to reproduce Linux-Chrome bugs. |
| `ytdl release linux-vm setup` | `pnpm setup:linux-vm` | One-time: creates the Ubuntu `ytdl-linux` VM, mounts the repo, installs Node/pnpm/Chrome deps, wires the CDP port proxy. |
| `ytdl release linux-vm dev` | `pnpm dev:linux` | Daily: starts the VM if it's down, syncs the current branch in, runs `pnpm dev` under Xvfb + VNC. |
| `ytdl release package` | `pnpm release` | Builds, zips, packs the CRX, signs the Firefox build and writes `docs/updates.json`. |

The `ytdl` commands are the Rust crate in `tools/` (`pnpm ytdl <group> <command>`, `pnpm ytdl --help` lists the groups, `pnpm tools:test` runs its tests).

Supporting files used by the above:
- `cdp-utils.ts` - shared CDP helpers used by the dev server.
- `dev-bridge.ts` - the JSON-lines bridge to the Rust sidecar (`dev-server/`).
- `dev/server/` - the launcher: options, profiles, browser launch, build, sidecar handlers.
- `dev/output/` - the built manifest, the build-to-build diff that plans each update, and the dev-build-only patches (background prelude, run-once guard, download-panel handshake recorder/replay).
- `dev/browsers/` - the browser-target contract and log wording, the in-place background swap, and the Chrome (CDP) and Firefox (RDP) sides.
- `dev/hmr/` - the HMR build (Vite + Svelte compile, `$state` preservation), the side-effect analysis that decides what can hot-swap, and the in-browser runtimes.
- `web-ext-run.d.ts` - type stubs for `web-ext-run` (Firefox launcher).
- `tsconfig.json` - TS config scoped to scripts (the project tsconfig excludes this folder).

## Debugging utilities (`pnpm ytdl ...`)

The ad hoc debugging scripts are now commands of the Rust crate in `tools/`. None of them affect a normal contributor workflow - **you can ignore this section unless you're chasing a specific bug.** Every command takes the debug port of the instance to inspect and never starts or stops a browser.

- **Chrome DevTools Protocol** (`ytdl cdp ...`: `eval`, `reload`, `inspect`, `check`, `dump`, `bisect`, `screenshot`) - attach to a running dev-server Chrome, dump logs, inspect extension state, force reloads, take screenshots. Default port 9229.
- **Firefox debugging** (`ytdl firefox ...`: `rdp-drive`, `rdp-eval`, `marionette`, `addon-console`) - Firefox doesn't speak CDP. These talk to Marionette and the Firefox Remote Debugging Protocol.
- **Verification** (`ytdl release verify-download`, `ytdl release cherry-pick-loop`) - checks a downloaded file against its YouTube source and automates regression hunting over a commit list.
- **Build output** (`ytdl output ...`: `manifest`, `snapshot`, `plan-reload`, `patch-manifest`, `profile`, `options`) - the build-output logic the launcher shares.

Still TypeScript because it needs the JS ecosystem or runs in the browser: the launcher (`dev/server/`), the HMR build and runtimes (`dev/hmr/`), the Chrome and Firefox targets (`dev/browsers/`), and `dev-bridge.ts`. The replaced originals are kept in `.verify/js-originals/` (untracked).

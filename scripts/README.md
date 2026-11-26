# Scripts

Build / dev / debugging utilities. Two categories:

## Contributor scripts

These are wired into `package.json` and are the ones you'll actually run.

| Script | Invoked by | Purpose |
| --- | --- | --- |
| `ytdl dev run` | `bun run dev`, `bun run dev:firefox` | Watches `src/`, rebuilds via WXT, launches one Chrome or Firefox instance with the extension installed, and on save applies the smallest update: hot-swaps popup and content-script components with their state, restarts the background in place, refreshes open extension pages, and reloads the extension (re-injecting the content scripts in place) only when nothing else works; only a MAIN-world script change reloads the tabs. `--cdp-port`, `--marionette-port`, `--profile-dir`, `--out-dir`, `--start-url`, `--mute-audio` (or `YTDL_DEV_*` env vars) run a second instance side by side. |
| `ytdl release linux-vm install-prerequisites` | `bun run install:hyperv-multipass` | One-time Windows setup: enables Hyper-V and installs Multipass. Relaunches itself elevated. Required only if you want to reproduce Linux-Chrome bugs. |
| `ytdl release linux-vm setup` | `bun run setup:linux-vm` | One-time: creates the Ubuntu `ytdl-linux` VM, mounts the repo, installs Node/Bun/Chrome deps, wires the CDP port proxy. |
| `ytdl release linux-vm dev` | `bun run dev:linux` | Daily: starts the VM if it's down, syncs the current branch in, runs `bun run dev` under Xvfb + VNC. |
| `ytdl release package` | `bun run release` | Builds, zips, packs the CRX, signs the Firefox build and writes `docs/updates.json`. |

The `ytdl` commands are the Rust crate in `tools/` (`bun run ytdl <group> <command>`, `bun run ytdl --help` lists the groups, `bun run tools:test` runs its tests).

- `tsconfig.json` - TS config scoped to scripts (the project tsconfig excludes this folder).

## Debugging utilities (`bun run ytdl ...`)

The ad hoc debugging scripts are now commands of the Rust crate in `tools/`. None of them affect a normal contributor workflow - **you can ignore this section unless you're chasing a specific bug.** Every command takes the debug port of the instance to inspect and never starts or stops a browser.

- **Chrome DevTools Protocol** (`ytdl cdp ...`: `eval`, `reload`, `inspect`, `check`, `dump`, `bisect`, `screenshot`) - attach to a running dev-server Chrome, dump logs, inspect extension state, force reloads, take screenshots. Default port 9229.
- **Firefox debugging** (`ytdl firefox ...`: `rdp-drive`, `rdp-eval`, `marionette`, `addon-console`) - Firefox doesn't speak CDP. These talk to Marionette and the Firefox Remote Debugging Protocol.
- **Verification** (`ytdl release verify-download`, `ytdl release cherry-pick-loop`) - checks a downloaded file against its YouTube source and automates regression hunting over a commit list.
- **Build output** (`ytdl output ...`: `manifest`, `snapshot`, `plan-reload`, `patch-manifest`, `profile`, `options`) - the build-output logic the launcher shares.

The dev server is Rust (`tools/src/dev/`, with the sidecar in `dev-server/`); only Vite, the Svelte compiler and WXT run in Node, as warm workers (`tools/assets/`).

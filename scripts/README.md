# Scripts

Build / dev / debugging utilities. Two categories:

## Contributor scripts

These are wired into `package.json` and are the ones you'll actually run.

| Script | Invoked by | Purpose |
| --- | --- | --- |
| `dev-server.ts` | `pnpm dev`, `pnpm dev:firefox` | Watches `src/`, rebuilds via WXT, launches a clean Chrome or Firefox instance with the extension installed, and force-reloads every open YouTube tab on save. |
| `install-hyperv-multipass.ps1` | `pnpm install:hyperv-multipass` | One-time Windows setup: enables Hyper-V and installs Multipass. Run elevated. Required only if you want to reproduce Linux-Chrome bugs. |
| `setup-linux-vm.ps1` | `pnpm setup:linux-vm` | One-time: creates the Ubuntu `ytdl-linux` VM, mounts the repo, installs Node/pnpm/Chrome deps, wires the CDP port proxy. |
| `linux-vm-dev.ts` | `pnpm dev:linux` | Daily: starts the VM if it's down, syncs the current branch in, runs `pnpm dev` under Xvfb + VNC. |
| `linux-vm-provision.sh` | (invoked by `setup-linux-vm.ps1`) | Runs inside the VM. Don't run it directly on the host. |

Supporting files used by the above:
- `cdp-utils.ts` - shared CDP helpers used by `dev-server.ts` and the debugging scripts.
- `web-ext-run.d.ts` - type stubs for `web-ext-run` (Firefox launcher).
- `tsconfig.json` - TS config scoped to scripts (the project tsconfig excludes this folder).

## Debugging utilities

These were written ad hoc to diagnose specific bugs and are not wired into `package.json`. They're kept around because the next regression in the same area is faster to investigate by adapting an existing script than writing a new one from scratch. They're also `.gitignore`-friendly targets for log files and screenshots, which is why you'll see `.txt`, `.log`, `.json`, and `.png` artifacts mixed in.

Run them with `tsx <file>` or `node <file>` from the repo root. None of them affect a normal contributor workflow - **you can ignore this entire section unless you're chasing a specific bug.**

Grouped by what they investigate:

- **Chrome DevTools Protocol** (`cdp-*.mjs`, `dump-*.mjs`, `inspect-*.mjs`, `check-*.mjs`, `reload-yt.mjs`, `capture-logs.mjs`) - attach to a running dev-server Chrome, dump logs, inspect extension state, force reloads. Useful when something only repros in CI-style flows.
- **Firefox debugging** (`firefox-marionette-eval.ts`, `firefox-rdp-eval.ts`, `firefox-addon-console.ts`) - Firefox doesn't speak CDP. These talk to Marionette and the Firefox Remote Debugging Protocol. See `reference_firefox_debug_ports.md` in `~/.claude/projects/.../memory/` (if you have it) for which port speaks what.
- **Bisecting** (`bisect-*.mjs`, `cherry-pick-loop.mjs`) - automated git-bisect harnesses. Used to track down regressions in long commit chains.
- **Verification** (`verify-download.mjs`) - runs ffprobe + SSIM + AV-sync checks on a downloaded file against its YouTube source. Used to autonomously verify "the download still works after this change."

If you write a new debugging script, drop it in here and add a one-line comment at the top explaining what bug it was investigating. Future-you (or future-Claude) will thank you.

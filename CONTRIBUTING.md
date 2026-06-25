# Contributing

This guide gets you from `git clone` to a working dev loop and a mergeable PR. For how the system is put together, read [ARCHITECTURE.md](ARCHITECTURE.md) — it has the system diagram, a codemap of every `src/` directory, and the invariants the code relies on.

## Quick start

Prerequisites: [Node](https://nodejs.org) 22+ and [pnpm](https://pnpm.io) (`corepack enable` is the easiest way to get it).

```sh
pnpm install
pnpm dev            # Chrome
pnpm dev:firefox    # Firefox
```

`pnpm dev` runs [`scripts/dev-server.ts`](scripts/dev-server.ts): it production-builds the extension (with source maps), launches a browser with it sideloaded, and on every file change under `src/` rebuilds, reloads the extension, and reloads every open YouTube tab. No manual reloading.

No `.env` is needed for development. [`.env.example`](.env.example) documents the variables used for release signing (Firefox AMO) and analytics.

Other useful commands:

```sh
pnpm build              # production build (Chrome)
pnpm build:firefox      # production build (Firefox)
pnpm pack               # zip the build for distribution
```

## Orienting yourself

The 30-second mental model: MV3 splits the extension across isolated runtimes, so a download is a relay race. The MAIN-world content script resolves everything from the page (stream URLs, PO token, captions) and packs it into a single `DownloadRequest`; the ISOLATED content script forwards it to the background; the background orchestrates the fetch (a 4-layer fallback chain on Chrome, an `ANDROID_VR` InnerTube bypass on Firefox); the offscreen document hosts FFmpeg WASM which muxes the result; `browser.downloads` saves the file.

Start with these three, in order:

1. [ARCHITECTURE.md](ARCHITECTURE.md) — the system diagram maps every step of that relay to the exact file and function.
2. [`src/entrypoints/`](src/entrypoints) — one folder per runtime (content scripts, background, offscreen, popup, workers). WXT auto-discovers these as entrypoints.
3. [`src/lib/`](src/lib) — shared code, grouped by domain (`youtube/`, `messaging/`, `download-pipeline/`, `storage/`, `ui/`, `utils/`).

### The four messaging buses

The most common newcomer confusion is which bus connects which runtimes. They are deliberately separate and live in [`src/lib/messaging/`](src/lib/messaging):

| Bus | Boundary | Transport |
| --- | --- | --- |
| `crossWorldMessenger` ([cross-world-messenger.ts](src/lib/messaging/cross-world-messenger.ts)) | MAIN world ↔ ISOLATED world, same page | `CustomEvent` on `window` |
| `MessageType` ([messaging.ts](src/lib/messaging/messaging.ts)) | content scripts / popup ↔ background | `browser.runtime` via `@webext-core/messaging` |
| `OffscreenMessageType` ([offscreen-messaging.ts](src/lib/messaging/offscreen-messaging.ts)) | background ↔ offscreen document | `MessagePort` |
| `sabrFetchBridge` ([sabr-fetch-bridge.ts](src/lib/messaging/sabr-fetch-bridge.ts)) | page iframe ↔ extension | `window.postMessage` |

### Naming patterns you'll see

- `Component.svelte` + `Component.<purpose>.svelte.ts` — Svelte 5 rune state and effects extracted from a component, e.g. `WatchButton.svelte` with `WatchButton.state.svelte.ts`. The `.svelte.ts` suffix is what enables runes outside a component.
- `*.content.ts` / `*.content/` under `src/entrypoints/` — content scripts; the WXT `world` option in each file's `defineContentScript` says whether it runs in MAIN or ISOLATED world.
- `el` prefix for elements, `is` prefix for booleans, `i` prefix for indexes, `SCREAMING_SNAKE_CASE` for module-level constants.

## Code style

[CLAUDE.md](CLAUDE.md) is the authoritative style guide and is enforced in review. The rules that shape the code most:

- Early returns, minimal nesting, functional style, `for-of` over `.forEach`
- No comments — use descriptive names instead
- Hardcoded strings go in enums, hardcoded numbers in `SCREAMING_SNAKE_CASE` constants
- Use the `browser` namespace, never `chrome`
- Content-script UI takes all styling from YouTube's own Polymer runtime — no custom CSS
- Don't persist settings automatically; rely on fallback values until the user explicitly sets something

**Every change must work on both Chrome MV3 and Firefox MV3.** Prefer one shared code path; branch only where an API genuinely diverges (the only browser probe is `isFirefoxRuntime()` in [`background-downloader.ts`](src/entrypoints/background/download/background-downloader.ts)).

## Quality gates

Run these before pushing — all must pass:

```sh
pnpm lint           # oxlint + ESLint, both with --fix
pnpm stylelint      # CSS + Svelte styles, with --fix
pnpm svelte-check
pnpm compile        # tsc --noEmit
npx fallow audit    # dead code + complexity on your changed files
```

## Common tasks

**Add a user setting (popup):**

1. Add the field to `Options` in [`src/types/settings-types.ts`](src/types/settings-types.ts)
2. Add its default to `INITIAL_OPTIONS` in [`src/lib/youtube/options-defaults.ts`](src/lib/youtube/options-defaults.ts)
3. Create a section component in [`src/entrypoints/popup/settings/sections/`](src/entrypoints/popup/settings/sections) (copy an existing one) and register it in [`SettingsTab.svelte`](src/entrypoints/popup/settings/SettingsTab.svelte)
4. Persist with `setOption` from [`src/lib/storage/storage.ts`](src/lib/storage/storage.ts); read in content scripts via `CONTENT_OPTIONS` or `optionsItem`

**Debug a download failure:** find the failing stage in the [ARCHITECTURE.md system diagram](ARCHITECTURE.md#system-diagram), then use the "Where each step lives" table to jump straight to the file. The fallback chain logs which layer it's on.

## Commits and PRs

- Conventional-commit style subjects under 70 characters: `fix(firefox): …`, `feat(popup): …`, `docs(readme): …`
- Skip the body unless something is genuinely non-obvious
- Update ARCHITECTURE.md only when an architectural invariant changes (new context boundary, new browser branch, new top-level directory) — not for renames, timeouts, or message names

## Testing on Chrome on Linux

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

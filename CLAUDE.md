# Stack
- pnpm
- WXT extension framework
- Svelte 5 (content scripts and popup)
- TypeScript (100% type safety, let TypeScript infer return types)
- @ffmpeg/ffmpeg for video/audio processing
- @webext-core/messaging for message passing
- Chromium (Chrome, Edge, Opera) MV3 + Firefox MV3
  - Single shared code path; branch only when an API genuinely diverges
  - Offscreen API is Chrome-only; Firefox falls back to a hidden iframe hosted by the background event page (see `background/handlers/processor.ts`)
  - Firefox manifest is emitted via the `manifest` function in `wxt.config.ts` (no `offscreen` permission, no `minimum_chrome_version`, gets `browser_specific_settings.gecko`)

# Code style
- Use the `browser` namespace
- Use early returns for readability and maintainability
- Use functional programming
- Use async/await whenever possible
- Use DRY with separation of concerns, prioritizing readability
- Minimize indentations
- Use `for-of` instead of `.forEach`
- Use modern browser and CSS features
- Avoid `window.` prefixes unless it increases readability
- Avoid `setTimeout` unless absolutely necessary
- Avoid comments unless absolutely necessary - prefer descriptive names
- Don't use em dashes - use regular hyphens
- If a callback arrow function has a typed param, don't annotate the type explicitly
- Avoid nested try/catch - flatten with early returns or extracted functions
- Apply parallel modifications whenever possible

# Naming conventions
- Variables and functions: `camelCase`, full words (no abbreviations)
- Module-level constants: `SCREAMING_SNAKE_CASE`

## Variable prefixes
- Element: `el` prefix (e.g. `elButton`)
- Index: `i` prefix (e.g. `iItem`), or bare `i` when iterating in a for loop/higher-order function
- Boolean: `is` prefix (e.g. `isLoading`)

# Hardcoded values
- Strings: use enums; if no enum fits, use a descriptive `SCREAMING_SNAKE_CASE` constant
- Numbers: use a descriptive `SCREAMING_SNAKE_CASE` constant

# Svelte
- Single-use functions: inline them
- `@attach` arrow functions in templates: extract to named functions in the script block

# Storage
- Don't automatically persist to storage - rely on fallback values; only use storage when the user has explicitly set something

# UI copy
- No full stops at end of messages
- Informal tone

# Linting
After each modification, lint with oxlint, ESLint, Stylelint, svelte-check, and `npx fallow audit`.

# Dev server
`pnpm dev` (the Rust `ytdl dev run` in `tools/`, with the sidecar in `dev-server/`) rebuild on any change under `src/` and apply the smallest update, keeping the open YouTube tabs. The Rust server keeps its Node workers warm, so a component edit hot-swaps in about 0.3s:
- Popup/offscreen/worker change: reloads the open popup, closes the offscreen document (recreated on next use)
- `youtube.content` change outside a component: the HMR runtime restarts the content script in place, with no extension or tab reload. Message handlers are dropped first (`disposeOnRestart` wraps each messenger), so tie any other registration to the content script context
- Manifest change, or another ISOLATED content script: reloads the extension and re-injects `youtube.content` into open tabs in place
- MAIN-world content-script change: reloads the extension; no YouTube tab is ever reloaded, the log counts the ones keeping the old page script
- The log line names the outcome; flags `--cdp-port`, `--profile-dir`, `--out-dir` run a second instance side by side

# Lint exceptions
- Lint runs through `avi12-lint` (shared presets from `avi12/lint-config`); an exemption goes in `.oxlintrc.json` or `eslint.config.js` with its reason, never at the line
- `house/positional-parameters` is off for `format-filters.ts` (`byQualityDesc`) and `audio-language-helpers.ts` (`byLabel`), which are `Array.sort` comparators, and for `movie-player.ts` (`captureApply`), a `Proxy` `apply` trap; the signatures are fixed by the platform
- `typescript/unbound-method` is off for `iframe-mute.content.ts`, `sourcebuffer-capture-patches.ts` and `movie-player.ts`: they patch a native prototype method and call the saved original with `.call(this, ...)`, so the unbound reference is the point
- `emscripten-fs.d.ts` keeps `interface FS`: it merges into the `FS` interface of `@ffmpeg/types`, so the name is fixed by that package; the `id-length` override in `.oxlintrc.json` adds it to the exceptions
- `__ytdlAudioWatched`, `__ytdlCaptionWatched` and `__ytdlCapture` are marker flags set on YouTube's player object; the double underscore keeps them out of YouTube's own names, and `naming/convention` lists them in `allowedNames`
- `declaration-no-important` is off in `.stylelintrc.json` for `App.svelte` (the reduced-motion reset) and the YouTube-page components under `src/layers/youtube/components`, whose declarations must beat YouTube's own styles
- `selector-pseudo-element-no-unknown` ignores `::view-transition-group-children` in `.stylelintrc.json` for `ChangeFormatDialog.svelte`: it is the nested view transition pseudo-element that clips the morphing dialog, which Stylelint does not know yet
- `dev-server/bindings/` is in `.oxlintrc.json`'s `ignorePatterns`: ts-rs generates it from the sidecar's wire types (`cargo test` rewrites it and fails on drift), so its formatting is the generator's
- `tools/assets/browsers/` and `tools/assets/payload/` are in `.oxlintrc.json`'s `ignorePatterns` and `eslint.config.js`'s `ignores`: they are snippets the dev server evaluates inside the browser (expression statements, no module scope), so the module-style rules do not apply

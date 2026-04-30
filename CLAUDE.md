# Stack
- pnpm
- WXT extension framework
- Svelte 5 (content scripts and popup)
- TypeScript (100% type safety, let TypeScript infer return types)
- @ffmpeg/ffmpeg for video/audio processing
- @webext-core/messaging for message passing
- Chromium (Chrome, Edge, Opera) and Firefox MV3

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
- No comments - use descriptive variable and function names instead. Only add a comment when the WHY is genuinely non-obvious (hidden constraint, workaround, subtle invariant). Never describe what the code does
- Don't use em dashes - use regular hyphens
- If a callback arrow function has a typed param, don't annotate the type explicitly
- Avoid nested try/catch - flatten with early returns or extracted functions
- Apply parallel modifications whenever possible
- Keep functions focused on a single job - extract named helpers when a function does more than one distinct logical task
- Use `Promise.all` for independent async operations instead of sequential `await`; never await sequentially when the calls have no data dependency on each other
- Use destructuring whenever it will increase the code readability

# Naming conventions
- Variables and functions: `camelCase`, full words (no abbreviations)
- Module-level constants: `SCREAMING_SNAKE_CASE`
- Exception: event handler first parameter is always `e`

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

# Commits
- Subject line only - no body unless the why is genuinely non-obvious from the diff
- Be direct: `extract handleMissingStream` not `refactor to extract handleMissingStream helper function`

# Linting
After each modification, lint with ESLint, Stylelint, svelte-check, and fallow.

# Messaging
Use `@webext-core/messaging` for one-shot messages and the project's typed long-lived port abstractions (e.g. `scrub-iframe-messaging.ts`) for streaming channels. Never use `window.addEventListener('message')` or raw `browser.runtime.connect` for cross-context messaging.

# Dev server
`scripts/dev-server.ts` auto-rebuilds and reloads the extension and every YouTube page on any file change under `src/` and `wxt.config.ts`

The iframes for Chrome MV3 and Firefox MV3 must be injected into an offscreen page (e.g. offscreen document or background page). No hidden tabs and so on.   

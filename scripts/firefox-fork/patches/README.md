# Gecko patches

Each `.patch` file is applied in lexical order by the build script. Patches
target specific files in a Mozilla-Central checkout. Keep each patch small
and focused — easier to rebase against new Firefox releases.

## Current patches

### `00-navigator-webdriver.patch` (not yet written)

**Target:** `dom/base/Navigator.cpp` — the getter backing the `webdriver`
attribute declared in `dom/webidl/Navigator.webidl` as:

```
interface mixin NavigatorAutomationInformation {
  [Constant, Cached]
  readonly attribute boolean webdriver;
};
```

The `[Constant, Cached]` means Firefox computes it once per Navigator and
caches the result, so patching the single C++ getter is enough.

**Change:** Replace the current implementation with `return false;`.
**Why:** The `dom.webdriver.enabled=false` pref override we already apply in
`dev-server.ts` makes the getter return false today, but only because the
current implementation respects that pref. Hard-coding the getter decouples
us from any future Firefox release that rewrites this logic (e.g. keying off
a new automation protocol that forgets to check the pref).

The exact line range in `dom/base/Navigator.cpp` needs to be found in the
specific Firefox tag being built — search for `Webdriver(` in that file.

### `01-hide-remote-agent.patch` (not yet written)

**Target:** `remote/components/RemoteAgent.sys.mjs` (or equivalent — verify
against the tree you're building).
**Change:** Suppress any JS-observable side effect of `--remote-debugging-port`.
**Why:** When Firefox launches with `--remote-debugging-port`, it currently
exposes no JS global for the Remote Agent (as far as we know), but in some
Firefox versions it does flip subtle prefs that BotGuard-style fingerprinters
sample. Confirm in the version being built and patch as needed.

### `02-hide-marionette.patch` (not yet written)

**Target:** `remote/marionette/server.sys.mjs` and any module that registers
`@mozilla.org/remote/marionette/*` at XPCOM-level-visible endpoints.
**Change:** Keep the TCP server listening (we need it for web-ext-run
sideload + MCP) but remove any `window` / `navigator` / document-visible state
that says "marionette is on".
**Why:** This is the big one. The server itself on 127.0.0.1:2828 isn't
detectable by a JS-only fingerprinter (can't port-scan from JS), but Gecko
may flip prefs or set XPCOM components when marionette is active that
indirectly leak into the page. Investigate before patching.

## How to research a patch

1. Start regular (stock) Firefox → open `about:config` → note `dom.webdriver.enabled`,
   `marionette.*`, `remote.*` prefs.
2. Start dev (web-ext-run) Firefox → same inspection → diff.
3. In a YouTube tab on each, run `JSON.stringify({ wd: navigator.webdriver,
   chrome: 'chrome' in window, plugins: navigator.plugins.length, perms:
   (await navigator.permissions.query({name:'notifications'})).state })`
   and compare.
4. Anything that differs between stock and dev is a candidate signal. Find the
   C++ or JSM that exposes it in the source (`searchfox.org/mozilla-central`)
   and patch there.

## Non-goals

- **Don't** strip marionette or RDP entirely — we need them for MCP and
  web-ext-run. The goal is keeping them functional but invisible.
- **Don't** disable the pref subsystem — regular users can still set
  `dom.webdriver.enabled`, we just want the default to be the safe path.

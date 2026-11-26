//! The JavaScript the dev server injects, as source text with `@@NAME@@` placeholders filled in.

use super::hmr_names::HMR_ENTRY_GLOBAL;
use super::main_world::SWAPPABLE_MARKER;
use serde_json::Value;

pub(crate) const REQUEST_EVENT: &str = "@webext-core/messaging/custom-events";
const RESPONSE_EVENT: &str = "@webext-core/messaging/custom-events/response";
/// `CrossWorldMessage.PanelContentReady` in `src/lib/messaging/cross-world-messenger.ts`.
const REPLAYED_MESSAGE_TYPES: [&str; 1] = ["panelContentReady"];
const RECORDS_GLOBAL: &str = "__ytdlDevCrossWorldRecords";
const RAN_CONTENT_SCRIPTS_GLOBAL: &str = "__ytdlDevRanContentScripts";
const REPLAY_ATTEMPTS: u32 = 20;
const REPLAY_ANSWER_TIMEOUT_MS: u32 = 250;
/// The runs of the swappable page-world scripts, each with the steps that undo it.
const SWAPPABLE_RUNS_GLOBAL: &str = "__ytdlDevMainWorldRuns";
/// Replayed messages get a fresh random id below this, like `@webext-core/messaging`'s own ids.
const REPLAY_MESSAGE_ID_RANGE: u32 = 1_000_000_000;

const RECORDER_TEMPLATE: &str = r"(() => {
  const records = new Map();
  globalThis[@@RECORDS_GLOBAL@@] = records;
  addEventListener(@@REQUEST_EVENT@@, e => {
    const type = e.detail?.message?.type;
    if (@@REPLAYED_TYPES@@.includes(type)) {
      records.set(type, e.detail);
    }
  });
})();
";

const GUARD_TEMPLATE: &str = "if (!(@@RAN@@ ??= new Set()).has(@@NAME@@)) {
@@RAN@@.add(@@NAME@@);
@@SOURCE@@
}
";

/// Runs a page-world script after undoing its previous build's run: the listeners it added and the
/// `document` properties and `window` accessors it defined. A script the run-once guard already ran
/// is left alone, since nothing recorded how to undo it. The list of scripts that ran is shared with
/// that guard, so a later build that is no longer swappable never runs beside this one.
const SWAPPABLE_TEMPLATE: &str = r#"@@MARKER@@
(() => {
  const ran = (globalThis[@@RAN@@] ??= new Set());
  const runs = (globalThis[@@RUNS@@] ??= new Map());
  const previous = runs.get(@@NAME@@);
  if (previous?.hash === @@HASH@@ || (!previous && ran.has(@@NAME@@))) {
    return;
  }

  for (const undo of previous?.undoSteps.reverse() ?? []) {
    undo();
  }

  const undoSteps = [];
  ran.add(@@NAME@@);
  runs.set(@@NAME@@, { hash: @@HASH@@, undoSteps });
  const unwraps = [];
  for (const owner of [EventTarget.prototype, window, document]) {
    const own = Object.getOwnPropertyDescriptor(owner, "addEventListener");
    if (!own) {
      continue;
    }

    const add = owner.addEventListener;
    Object.defineProperty(owner, "addEventListener", {
      configurable: true,
      enumerable: own.enumerable,
      writable: true,
      value(type, listener, options) {
        const target = this ?? window;
        add.call(target, type, listener, options);
        undoSteps.push(() => target.removeEventListener(type, listener, options));
      }
    });
    unwraps.push(() => Object.defineProperty(owner, "addEventListener", own));
  }

  const watched = [
    { target: document, isTracked: () => true },
    { target: window, isTracked: descriptor => Boolean(descriptor.get) }
  ].map(item => ({ ...item, before: Object.getOwnPropertyDescriptors(item.target) }));
  const isSame = (a, b) => a?.value === b?.value && a?.get === b?.get && a?.set === b?.set;
  try {
@@SOURCE@@
  } finally {
    for (const unwrap of unwraps) {
      unwrap();
    }

    for (const { target, isTracked, before } of watched) {
      for (const key of Reflect.ownKeys(target)) {
        const after = Object.getOwnPropertyDescriptor(target, key);
        const earlier = before[key];
        if (!after?.configurable || !isTracked(after) || isSame(earlier, after)) {
          continue;
        }

        undoSteps.push(() => {
          if (!isSame(Object.getOwnPropertyDescriptor(target, key), after)) {
            return;
          }

          if (earlier) {
            Object.defineProperty(target, key, earlier);
            return;
          }

          delete target[key];
        });
      }
    }
  }
})();
"#;

const LOADER_TEMPLATE: &str = r#"(async () => {
  const ancestors = globalThis.location.ancestorOrigins;
  const isInExtensionPage = self !== top && ancestors?.[ancestors.length - 1]?.startsWith("chrome-extension:");
  if (isInExtensionPage) {
    @@STATIC_SOURCE@@
    return;
  }

  const api = globalThis.browser ?? globalThis.chrome;
  const hmrUrl = path => api.runtime.getURL(path);
  globalThis.@@ENTRY_GLOBAL@@ = @@ENTRY@@;
  await import(hmrUrl(@@RUNTIME_PATH@@));
  const manifest = await (await fetch(hmrUrl(@@MANIFEST_PATH@@), { cache: "no-store" })).json();
  const entry = await import(hmrUrl(manifest.entries[@@ENTRY@@]) + "?t=" + Date.now());
  await entry.run();
})();
// @@HASH@@
"#;

/// A function source for `scripting.executeScript({ world: "MAIN", func })`: re-sends each recorded
/// message under a fresh id until a listener answers, and resolves to how many were delivered.
const REPLAY_TEMPLATE: &str = r"async () => {
  const records = globalThis[@@RECORDS_GLOBAL@@];
  if (!records) {
    return 0;
  }

  let deliveredCount = 0;
  for (const detail of records.values()) {
    for (let attempt = 0; attempt < @@ATTEMPTS@@; attempt++) {
      const id = Math.floor(Math.random() * @@ID_RANGE@@);
      const isAnswered = await new Promise(resolve => {
        const timer = setTimeout(() => {
          removeEventListener(@@RESPONSE_EVENT@@, onResponse);
          resolve(false);
        }, @@TIMEOUT@@);
        function onResponse(e) {
          if (e.detail?.namespace !== detail.namespace || e.detail?.message?.id !== id) {
            return;
          }

          clearTimeout(timer);
          removeEventListener(@@RESPONSE_EVENT@@, onResponse);
          resolve(true);
        }

        addEventListener(@@RESPONSE_EVENT@@, onResponse);
        dispatchEvent(new CustomEvent(@@REQUEST_EVENT@@, {
          detail: { ...detail, message: { ...detail.message, id, timestamp: Date.now() } }
        }));
      });
      if (isAnswered) {
        deliveredCount++;
        break;
      }
    }
  }
  return deliveredCount;
}";

fn literal(text: &str) -> String {
    Value::from(text).to_string()
}

fn fill(template: &str, replacements: &[(&str, String)]) -> String {
    let mut text = template.to_owned();
    for (name, value) in replacements {
        text = text.replace(&format!("@@{name}@@"), value);
    }
    text
}

/// The page-world recorder of the cross-world messages a hot-swap replays.
pub(crate) fn recorder_source() -> String {
    fill(
        RECORDER_TEMPLATE,
        &[
            ("RECORDS_GLOBAL", literal(RECORDS_GLOBAL)),
            ("REQUEST_EVENT", literal(REQUEST_EVENT)),
            (
                "REPLAYED_TYPES",
                Value::from(REPLAYED_MESSAGE_TYPES.to_vec()).to_string(),
            ),
        ],
    )
}

/// The function source that replays the recorded handshakes into a fresh isolated script.
pub(crate) fn replay_function_source() -> String {
    fill(
        REPLAY_TEMPLATE,
        &[
            ("RECORDS_GLOBAL", literal(RECORDS_GLOBAL)),
            ("ATTEMPTS", REPLAY_ATTEMPTS.to_string()),
            ("ID_RANGE", REPLAY_MESSAGE_ID_RANGE.to_string()),
            ("RESPONSE_EVENT", literal(RESPONSE_EVENT)),
            ("REQUEST_EVENT", literal(REQUEST_EVENT)),
            ("TIMEOUT", REPLAY_ANSWER_TIMEOUT_MS.to_string()),
        ],
    )
}

/// Runs a content script at most once per world.
pub(crate) fn guard_run_once(name: &str, source: &str) -> String {
    fill(
        GUARD_TEMPLATE,
        &[
            (
                "RAN",
                format!("globalThis[{}]", literal(RAN_CONTENT_SCRIPTS_GLOBAL)),
            ),
            ("NAME", literal(name)),
            ("SOURCE", source.to_owned()),
        ],
    )
}

/// Makes a page-world script replace its own earlier run in an open tab.
pub(crate) fn swappable_main_world(name: &str, source: &str, source_hash: &str) -> String {
    fill(
        SWAPPABLE_TEMPLATE,
        &[
            ("MARKER", SWAPPABLE_MARKER.to_owned()),
            ("RAN", literal(RAN_CONTENT_SCRIPTS_GLOBAL)),
            ("RUNS", literal(SWAPPABLE_RUNS_GLOBAL)),
            ("NAME", literal(name)),
            ("HASH", literal(source_hash)),
            ("SOURCE", source.to_owned()),
        ],
    )
}

/// The loader that replaces a hot-swappable content script's bundle. A frame inside an extension
/// page (the offscreen document's `YouTube` iframe) cannot import the HMR modules, so it runs the
/// original bundle instead.
pub(crate) fn content_script_loader(
    entry_name: &str,
    runtime_path: &str,
    manifest_path: &str,
    static_source: &str,
    source_hash: &str,
) -> String {
    fill(
        LOADER_TEMPLATE,
        &[
            ("ENTRY_GLOBAL", HMR_ENTRY_GLOBAL.to_owned()),
            ("ENTRY", literal(entry_name)),
            ("RUNTIME_PATH", literal(runtime_path)),
            ("MANIFEST_PATH", literal(manifest_path)),
            ("STATIC_SOURCE", static_source.to_owned()),
            ("HASH", source_hash.to_owned()),
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_placeholder_survives() {
        let loader = content_script_loader(
            "youtube",
            "hmr/runtime.js",
            "hmr/manifest.json",
            "run();",
            "abc",
        );
        let sources = [
            recorder_source(),
            replay_function_source(),
            guard_run_once("a.js", "run();"),
            loader,
        ];
        for source in sources {
            assert!(!source.contains("@@"), "{source}");
        }
    }

    #[test]
    fn the_guard_wraps_the_source() {
        let guarded = guard_run_once("a.js", "run();");
        assert!(guarded.starts_with(
            "if (!(globalThis[\"__ytdlDevRanContentScripts\"] ??= new Set()).has(\"a.js\")) {"
        ));
        assert!(guarded.contains("\nrun();\n}"));
    }
}

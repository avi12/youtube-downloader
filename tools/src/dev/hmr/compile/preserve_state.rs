//! Rewrites that carry `$state` across a hot swap. Svelte 5 HMR recreates an edited component's whole
//! subtree and a re-imported `.svelte.ts` module re-runs its top level, so without these an edit
//! resets an open dialog, a selected tab or a store.

use regex::{Captures, Regex};
use serde_json::Value;

use crate::dev::hmr::config::HMR_RUNTIME_GLOBAL;
use crate::dev::hmr::error::Result;

/// Holds "how many OTHER instances of this component were already live" when this instance
/// initialised, so `restore()` preserves only for a singleton recreation (0), never a
/// multi-instance render (list rows would otherwise collide on a shared key).
const HMR_OTHERS_VAR: &str = "ytdlHmrOtherInstances";
const SCRIPT_CLOSE: &str = "</script>";

/// The instance `<script>` open tag (not `<script module>` / `<script context="module">`), so the
/// rewrite only touches per-instance UI state, never module-scope singletons.
const SCRIPT_OPEN: &str = r"<script(?-u:\b)";
const SCRIPT_MODULE_ATTRIBUTE: &str = r"(?-u:\b)(?:module|context)(?-u:\b)";
/// A top-level `let/const X = $state(...)` / `$state.raw(...)`, capturing the variable name. Svelte
/// only permits `$state` at the instance-script top level or as a class field, and a class field has
/// no `const|let|var` keyword, so this matches exactly the simple instance variables.
const INSTANCE_STATE_DECLARATION: &str = r"(?:^|\n)[ \t]*(?:const|let|var)[ \t]+([A-Za-z_$][A-Za-z0-9_$]*)[ \t]*=[ \t]*\$state(?:\.raw)?[ \t]*\(";
/// A module-level `$state` / `$state.raw` declaration start, capturing the variable name.
/// Anchored to column 0: an indented declaration is local to a factory function, and adopting it
/// would hand one instance's state to every other.
const MODULE_STATE_DECLARATION: &str = r"(?:^|\n)(?:export[ \t]+)?(?:const|let|var)[ \t]+([A-Za-z_$][A-Za-z0-9_$]*)[ \t]*=[ \t]*\$state(?:\.raw)?[ \t]*\(";
/// A module-level reactive instance - `new SvelteMap(...)`, `new SvelteSet(...)`,
/// `createSubscriber(...)` - capturing the variable name and the callee.
const MODULE_REACTIVE_INSTANCE: &str = r"(?:^|\n)(?:export[ \t]+)?(?:const|let|var)[ \t]+([A-Za-z_$][A-Za-z0-9_$]*)[ \t]*=[ \t]*(new[ \t]+Svelte[A-Za-z0-9_]+(?:<[^()]*>)?|createSubscriber)[ \t]*\(";
/// Only a simple single-declarator statement (next non-space after `)` is `;`, a newline or the end);
/// a multi-declarator `const a = $state(...), b = ...` is skipped to avoid mangling the rest.
const STATEMENT_END: &str = r"^[ \t]*(?:;|\r?\n|$)";

struct Insert {
    position: usize,
    text: String,
}

/// The compiled patterns of the two rewrites, built once per build.
pub(crate) struct StatePatterns {
    script_open: Regex,
    script_module_attribute: Regex,
    instance_state: Regex,
    module_state: Regex,
    reactive_instance: Regex,
    statement_end: Regex,
}

fn json_literal(text: &str) -> String {
    Value::String(text.to_owned()).to_string()
}

/// The index of the `)` that closes the `(` at `open_paren_index`, skipping over string and template
/// literals so a paren inside a string doesn't unbalance the scan. Nested templates aren't fully
/// modelled - a mis-scan just yields source the compile fallback catches.
fn find_matching_paren(code: &str, open_paren_index: usize) -> Option<usize> {
    let mut depth = 0_usize;
    let mut open_quote: Option<u8> = None;
    let mut bytes = code.bytes().enumerate().skip(open_paren_index);
    while let Some((index, byte)) = bytes.next() {
        if let Some(quote) = open_quote {
            let is_escape = byte == b'\\';
            if is_escape {
                bytes.next();
            } else {
                let is_closing_quote = byte == quote;
                if is_closing_quote {
                    open_quote = None;
                }
            }
            continue;
        }
        match byte {
            b'\'' | b'"' | b'`' => open_quote = Some(byte),
            b'(' => depth += 1,
            b')' => {
                depth = depth.saturating_sub(1);
                let is_outermost = depth == 0;
                if is_outermost {
                    return Some(index);
                }
            }
            _ => {}
        }
    }
    None
}

/// Applies the inserts from the highest offset down, so earlier positions stay valid as it goes.
fn apply_inserts(code: &str, mut inserts: Vec<Insert>) -> String {
    inserts.sort_by_key(|insert| std::cmp::Reverse(insert.position));
    let mut result = code.to_owned();
    for insert in inserts {
        result.insert_str(insert.position, &insert.text);
    }
    result
}

fn variable_name<'text>(captures: &Captures<'text>) -> &'text str {
    captures.get(1).map_or("", |name| name.as_str())
}

impl StatePatterns {
    pub(crate) fn new() -> Result<Self> {
        Ok(Self {
            script_open: Regex::new(SCRIPT_OPEN)?,
            script_module_attribute: Regex::new(SCRIPT_MODULE_ATTRIBUTE)?,
            instance_state: Regex::new(INSTANCE_STATE_DECLARATION)?,
            module_state: Regex::new(MODULE_STATE_DECLARATION)?,
            reactive_instance: Regex::new(MODULE_REACTIVE_INSTANCE)?,
            statement_end: Regex::new(STATEMENT_END)?,
        })
    }

    /// The byte range just inside the first instance `<script>` tag.
    fn instance_script_content(&self, code: &str) -> Option<(usize, usize)> {
        for open in self.script_open.find_iter(code) {
            let attributes_start = open.end();
            let tag_length = code.get(attributes_start..)?.find('>')?;
            let attributes = code.get(attributes_start..attributes_start + tag_length)?;
            if self.script_module_attribute.is_match(attributes) {
                continue;
            }
            let content_start = attributes_start + tag_length + 1;
            let content_length = code.get(content_start..)?.find(SCRIPT_CLOSE)?;
            return Some((content_start, content_start + content_length));
        }
        None
    }

    /// Rewrites a component so its `$state` survives an HMR recreation: each init reads through the
    /// runtime's `restore()` and a `save()` effect writes it back, so a recreated instance re-reads
    /// its prior value (an open dialog stays open while a component under it is edited). Only
    /// primitives are actually preserved (`save()` drops object/ref keys), so DOM `bind:this` refs
    /// and lazy component refs re-init fresh. Best effort: anything the paren scan mishandles is
    /// caught by the compile fallback, so this can never make a component fail to build.
    pub(crate) fn preserve_local_state(&self, code: &str, component_id: &str) -> String {
        let Some((content_start, content_end)) = self.instance_script_content(code) else {
            return code.to_owned();
        };
        let mut state_names = Vec::new();
        let mut inserts = Vec::new();
        for captures in self.instance_state.captures_iter(code) {
            let Some(whole) = captures.get(0) else {
                continue;
            };
            let open_paren_index = whole.end() - 1;
            let is_outside_content =
                open_paren_index < content_start || open_paren_index > content_end;
            if is_outside_content {
                continue;
            }
            let Some(close_paren_index) = find_matching_paren(code, open_paren_index) else {
                continue;
            };
            let name = variable_name(&captures);
            let key = json_literal(&format!("{component_id}:{name}"));
            let restore =
                format!("globalThis.{HMR_RUNTIME_GLOBAL}.state.restore({key}, {HMR_OTHERS_VAR}, ");
            let argument = code
                .get(open_paren_index + 1..close_paren_index)
                .unwrap_or_default();
            if argument.trim().is_empty() {
                inserts.push(Insert {
                    position: open_paren_index + 1,
                    text: format!("{restore}undefined)"),
                });
            } else {
                inserts.push(Insert {
                    position: open_paren_index + 1,
                    text: restore,
                });
                inserts.push(Insert {
                    position: close_paren_index,
                    text: ")".to_owned(),
                });
            }
            state_names.push(name);
        }
        if state_names.is_empty() {
            return code.to_owned();
        }
        let component = json_literal(component_id);
        inserts.push(Insert {
            position: content_start,
            text: format!(
                "\nconst {HMR_OTHERS_VAR} = globalThis.{HMR_RUNTIME_GLOBAL}.state.enter({component});\n"
            ),
        });
        let save_effects = state_names
            .iter()
            .map(|name| {
                let key = json_literal(&format!("{component_id}:{name}"));
                format!(
                    "$effect(() => {{ globalThis.{HMR_RUNTIME_GLOBAL}.state.save({key}, {name}); }});"
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        inserts.push(Insert {
            position: content_end,
            text: format!(
                "\n{save_effects}\n$effect(() => () => globalThis.{HMR_RUNTIME_GLOBAL}.state.exit({component}));\n"
            ),
        });
        apply_inserts(code, inserts)
    }

    /// The edits that make one module-level declaration adopt the value of the first import. With
    /// `expression_start`, the whole expression from there to its closing paren is adopted (a
    /// reactive instance holds its own subscribers, so a second one would split every reader of the
    /// first from every writer of the second); without it, only the argument of `$state(...)` is.
    fn adoption_edits(
        &self,
        code: &str,
        declaration: &Declaration<'_>,
        expression_start: Option<usize>,
    ) -> Vec<Insert> {
        let Some(close_paren_index) = find_matching_paren(code, declaration.open_paren_index)
        else {
            return Vec::new();
        };
        let tail = code.get(close_paren_index + 1..).unwrap_or_default();
        let Some(statement_tail) = self.statement_end.find(tail) else {
            return Vec::new();
        };
        let key = json_literal(&format!("{}:{}", declaration.module_id, declaration.name));
        let adopt = format!("globalThis.{HMR_RUNTIME_GLOBAL}.state.adoptModuleState({key}, () => ");
        let remember = Insert {
            position: close_paren_index + 1 + statement_tail.len(),
            text: format!(
                "\nglobalThis.{HMR_RUNTIME_GLOBAL}.state.rememberModuleState({key}, {});\n",
                declaration.name
            ),
        };
        let wrap = match expression_start {
            // Adopting an argument opens two parens (`adoptModuleState(` and the `() => (` body)
            None => [
                Insert {
                    position: declaration.open_paren_index + 1,
                    text: format!("{adopt}("),
                },
                Insert {
                    position: close_paren_index,
                    text: "))".to_owned(),
                },
            ],
            Some(start) => [
                Insert {
                    position: start,
                    text: adopt,
                },
                Insert {
                    position: close_paren_index + 1,
                    text: ")".to_owned(),
                },
            ],
        };
        let [open, close] = wrap;
        vec![open, close, remember]
    }

    /// Preserves module-level `$state` singletons (the popup app state and friends) across
    /// re-import. A `.svelte.ts` store module re-runs on every hot-swap; without this it builds a
    /// fresh empty store that the components still holding the old one never see. Each
    /// `export const X = $state(<init>)` becomes `$state(adoptModuleState(key, () => <init>))` plus a
    /// `rememberModuleState(key, X)`, so the first proxy is reused on every later re-import - its
    /// data survives while the module's `$derived` recompute with their new logic.
    pub(crate) fn preserve_module_state(&self, code: &str, module_id: &str) -> String {
        let mut edits = Vec::new();
        for captures in self.module_state.captures_iter(code) {
            let Some(whole) = captures.get(0) else {
                continue;
            };
            let declaration = Declaration {
                module_id,
                name: variable_name(&captures),
                open_paren_index: whole.end() - 1,
            };
            edits.extend(self.adoption_edits(code, &declaration, None));
        }
        for captures in self.reactive_instance.captures_iter(code) {
            let (Some(whole), Some(callee)) = (captures.get(0), captures.get(2)) else {
                continue;
            };
            let declaration = Declaration {
                module_id,
                name: variable_name(&captures),
                open_paren_index: whole.end() - 1,
            };
            edits.extend(self.adoption_edits(code, &declaration, Some(callee.start())));
        }
        if edits.is_empty() {
            return code.to_owned();
        }
        apply_inserts(code, edits)
    }
}

struct Declaration<'text> {
    module_id: &'text str,
    name: &'text str,
    open_paren_index: usize,
}

#[cfg(test)]
mod tests;

//! Unit tests.

use super::*;

fn rule_of(source: &str) -> Option<SideEffectRule> {
    find_side_effect(source, "module.ts")
        .unwrap()
        .unwrap()
        .map(|found| found.rule)
}

#[test]
fn a_module_of_pure_declarations_is_safe_to_re_import() {
    assert_eq!(
        rule_of("export const LIMIT = 3;\nexport function add(a: number, b: number) { return a + b; }\nexport class Box {}"),
        None
    );
}

#[test]
fn listeners_registered_inside_functions_are_not_top_level_side_effects() {
    let source = "export function start() { addEventListener('x', f); setInterval(f, 1); new MutationObserver(f); }\nexport const stop = async () => { await go(); };";
    assert_eq!(rule_of(source), None);
}

#[test]
fn each_rule_fires_on_its_own_top_level_pattern() {
    let cases = [
        (
            "document.addEventListener('click', f);",
            SideEffectRule::EventListener,
        ),
        (
            "browser.runtime.onMessage.addListener(f);",
            SideEffectRule::ExtensionListener,
        ),
        ("setInterval(f, 1000);", SideEffectRule::Interval),
        (
            "const observer = new MutationObserver(f);",
            SideEffectRule::MutationObserver,
        ),
        (
            "export const { sendMessage } = defineCustomEventMessaging({});",
            SideEffectRule::CustomEventMessaging,
        ),
        (
            "export const messenger = defineWindowMessaging({});",
            SideEffectRule::WindowMessaging,
        ),
        (
            "export const value = await load();",
            SideEffectRule::TopLevelAwait,
        ),
        (
            "for await (const item of items) { use(item); }",
            SideEffectRule::TopLevelAwait,
        ),
        ("globalThis.__flag = true;", SideEffectRule::GlobalWrite),
        ("window.state.count = 1;", SideEffectRule::GlobalWrite),
    ];
    for (source, rule) in cases {
        assert_eq!(rule_of(source), Some(rule), "{source}");
    }
}

#[test]
fn a_function_invoked_immediately_runs_at_the_top_level() {
    assert_eq!(
        rule_of("(() => { setInterval(f, 1); })();"),
        Some(SideEffectRule::Interval)
    );
    assert_eq!(rule_of("const lazy = () => { setInterval(f, 1); };"), None);
}

#[test]
fn writing_to_a_local_object_is_not_a_global_write() {
    assert_eq!(
        rule_of("const state = { count: 0 };\nstate.count = 1;"),
        None
    );
}

#[test]
fn the_report_names_the_line_of_the_first_side_effect() {
    let found = find_side_effect("export const a = 1;\n\nsetInterval(f, 1);", "module.ts")
        .unwrap()
        .unwrap();
    assert_eq!(
        found,
        Some(SideEffect {
            rule: SideEffectRule::Interval,
            line: 3
        })
    );
}

#[test]
fn typescript_syntax_parses() {
    assert_eq!(
        rule_of("interface A { b: string }\nexport const a: A = { b: 'x' } satisfies A;"),
        None
    );
}

#[test]
fn a_syntax_error_is_reported_not_swallowed() {
    assert!(find_side_effect("export const = ;", "module.ts")
        .unwrap()
        .is_err());
}

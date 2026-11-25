//! Unit tests.

use super::*;

const COMPONENT_ID: &str = "src/Panel.svelte";
const MODULE_ID: &str = "src/store.svelte.ts";

fn patterns() -> StatePatterns {
    StatePatterns::new().unwrap()
}

#[test]
fn a_components_top_level_state_reads_through_restore_and_saves_back() {
    let code = patterns().preserve_local_state(
        "<script>\n  let isOpen = $state(false);\n</script>\n<p>{isOpen}</p>",
        COMPONENT_ID,
    );
    assert!(
        code.contains("state.restore(\"src/Panel.svelte:isOpen\", ytdlHmrOtherInstances, false)")
    );
    assert!(code.contains("state.save(\"src/Panel.svelte:isOpen\", isOpen)"));
    assert!(code.contains("state.exit(\"src/Panel.svelte\")"));
}

#[test]
fn a_module_script_and_a_component_without_state_stay_untouched() {
    let module_script = "<script module>\n  let count = $state(0);\n</script>";
    assert_eq!(
        patterns().preserve_local_state(module_script, COMPONENT_ID),
        module_script
    );
    let plain = "<script>\n  const label = \"x\";\n</script>";
    assert_eq!(patterns().preserve_local_state(plain, COMPONENT_ID), plain);
}

#[test]
fn an_empty_state_call_restores_undefined() {
    let code = patterns().preserve_local_state(
        "<script lang=\"ts\">\n  let picked = $state();\n</script>",
        COMPONENT_ID,
    );
    assert!(code.contains("ytdlHmrOtherInstances, undefined)"));
}

#[test]
fn a_module_level_state_store_is_adopted_across_re_imports() {
    let code = patterns()
        .preserve_module_state("export const store = $state({ items: [] });\n", MODULE_ID);
    assert!(code.contains(
        "$state(globalThis.ytdlDevHmr.state.adoptModuleState(\"src/store.svelte.ts:store\", () => ({ items: [] })))"
    ));
    assert!(code.contains("rememberModuleState(\"src/store.svelte.ts:store\", store)"));
}

#[test]
fn state_local_to_a_factory_function_is_left_alone() {
    let source = "function create() {\n  let data = $state(null);\n}\n";
    assert_eq!(patterns().preserve_module_state(source, MODULE_ID), source);
}

#[test]
fn a_reactive_instance_is_adopted_whole() {
    let code = patterns()
        .preserve_module_state("export const seen = new SvelteSet<string>();\n", MODULE_ID);
    assert!(code
        .contains("adoptModuleState(\"src/store.svelte.ts:seen\", () => new SvelteSet<string>())"));
}

#[test]
fn a_paren_inside_a_string_does_not_unbalance_the_scan() {
    assert_eq!(find_matching_paren("f(\")\", 1)", 1), Some(8));
}

import { preserveLocalState, preserveModuleState } from "./preserve-state.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const COMPONENT_ID = "src/Panel.svelte";
const MODULE_ID = "src/store.svelte.ts";

await test("a component's top-level $state reads through restore and saves back", () => {
  const code = preserveLocalState({
    code: "<script>\n  let isOpen = $state(false);\n</script>\n<p>{isOpen}</p>",
    componentId: COMPONENT_ID
  });
  assert.match(code, /state\.restore\("src\/Panel\.svelte:isOpen", ytdlHmrOtherInstances, false\)/);
  assert.match(code, /state\.save\("src\/Panel\.svelte:isOpen", isOpen\)/);
  assert.match(code, /state\.exit\("src\/Panel\.svelte"\)/);
});

await test("a module script and a component without $state stay untouched", () => {
  const moduleScript = "<script module>\n  let count = $state(0);\n</script>";
  assert.equal(
    preserveLocalState({
    code: moduleScript,
    componentId: COMPONENT_ID
  }), moduleScript
  );
  const plain = "<script>\n  const label = \"x\";\n</script>";
  assert.equal(
    preserveLocalState({
    code: plain,
    componentId: COMPONENT_ID
  }), plain
  );
});

await test("a module-level $state store is adopted across re-imports", () => {
  const code = preserveModuleState({
    code: "export const store = $state({ items: [] });\n",
    moduleId: MODULE_ID
  });
  assert.match(code, /\$state\(globalThis\.ytdlDevHmr\.state\.adoptModuleState\("src\/store\.svelte\.ts:store", \(\) => \(\{ items: \[\] \}\)\)\)/);
  assert.match(code, /rememberModuleState\("src\/store\.svelte\.ts:store", store\)/);
});

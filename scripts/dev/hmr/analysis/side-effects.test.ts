import { findSideEffect, SideEffectRule } from "./side-effects.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

function ruleOf(source: string) {
  return findSideEffect({
    source,
    filename: "module.ts"
  })?.rule;
}

await test("a module of pure declarations is safe to re-import", () => {
  assert.equal(ruleOf("export const LIMIT = 3;\nexport function add(a: number, b: number) { return a + b; }\nexport class Box {}"), undefined);
});

await test("listeners registered inside functions are not top-level side effects", () => {
  const source = "export function start() { addEventListener('x', f); setInterval(f, 1); new MutationObserver(f); }\nexport const stop = async () => { await go(); };";
  assert.equal(ruleOf(source), undefined);
});

await test("each rule fires on its own top-level pattern", () => {
  const cases: [string, string][] = [
    ["document.addEventListener('click', f);", SideEffectRule.EventListener],
    ["browser.runtime.onMessage.addListener(f);", SideEffectRule.ExtensionListener],
    ["setInterval(f, 1000);", SideEffectRule.Interval],
    ["const observer = new MutationObserver(f);", SideEffectRule.MutationObserver],
    ["export const { sendMessage } = defineCustomEventMessaging({});", SideEffectRule.CustomEventMessaging],
    ["export const messenger = defineWindowMessaging({});", SideEffectRule.WindowMessaging],
    ["export const value = await load();", SideEffectRule.TopLevelAwait],
    ["for await (const item of items) { use(item); }", SideEffectRule.TopLevelAwait],
    ["globalThis.__flag = true;", SideEffectRule.GlobalWrite],
    ["window.state.count = 1;", SideEffectRule.GlobalWrite]
  ];
  for (const [source, rule] of cases) {
    assert.equal(ruleOf(source), rule, source);
  }
});

await test("a function invoked immediately runs at the top level", () => {
  assert.equal(ruleOf("(() => { setInterval(f, 1); })();"), SideEffectRule.Interval);
  assert.equal(ruleOf("const lazy = () => { setInterval(f, 1); };"), undefined);
});

await test("writing to a local object is not a global write", () => {
  assert.equal(ruleOf("const state = { count: 0 };\nstate.count = 1;"), undefined);
});

await test("the report names the line of the first side effect", () => {
  const found = findSideEffect({
    source: "export const a = 1;\n\nsetInterval(f, 1);",
    filename: "module.ts"
  });
  assert.deepEqual(found, {
    rule: SideEffectRule.Interval,
    line: 3
  });
});

await test("TypeScript syntax parses", () => {
  assert.equal(ruleOf("interface A { b: string }\nexport const a: A = { b: 'x' } satisfies A;"), undefined);
});

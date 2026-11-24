/**
 * Decides whether a `.ts` / `.svelte.ts` module can be re-imported by the dev HMR without breaking the
 * running page. Re-evaluating a module runs its top level again, so a module whose top level
 * registers listeners, timers, observers or messaging channels, awaits, or writes to a global would
 * double them up: it stays on the reload path. This is the one place the rules live.
 */

import { FileExtension } from "#scripts/dev/enums.ts";
import { parseAst } from "vite";

export const SideEffectRule = {
  EventListener: "addEventListener",
  ExtensionListener: "browser.*.onX.addListener",
  Interval: "setInterval",
  MutationObserver: "MutationObserver",
  CustomEventMessaging: "defineCustomEventMessaging",
  WindowMessaging: "defineWindowMessaging",
  TopLevelAwait: "top-level await",
  GlobalWrite: "write to a global"
} as const;
type SideEffectRule = (typeof SideEffectRule)[keyof typeof SideEffectRule];

const CALLED_FUNCTION_RULES = new Map<string, SideEffectRule>([
  ["setInterval", SideEffectRule.Interval],
  ["defineCustomEventMessaging", SideEffectRule.CustomEventMessaging],
  ["defineWindowMessaging", SideEffectRule.WindowMessaging]
]);
const GLOBAL_OBJECTS = new Set(["globalThis", "window", "self", "document"]);
const EXTENSION_EVENT_NAME = /^on[A-Z]/;
const FUNCTION_NODE_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
// A source with no import or export would otherwise parse as a script, where top-level await is a syntax error
const MODULE_MARKER = "export {};";
const CLASS_NODE_TYPES = new Set(["ClassDeclaration", "ClassExpression"]);

interface AstNode {
  type: string;
  start: number;
  [key: string]: unknown;
}

interface SideEffect {
  rule: SideEffectRule;
  line: number;
}

function isAstNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null && "type" in value && typeof value.type === "string" && "start" in value && typeof value.start === "number";
}

function memberPropertyName(node: unknown) {
  const isMember = isAstNode(node) && node.type === "MemberExpression";
  if (!isMember) {
    return undefined;
  }

  const { property } = node;
  return isAstNode(property) && typeof property.name === "string" ? property.name : undefined;
}

function rootObjectName(node: unknown) {
  let current = node;
  while (isAstNode(current) && current.type === "MemberExpression") {
    current = current.object;
  }

  return isAstNode(current) && current.type === "Identifier" && typeof current.name === "string" ? current.name : undefined;
}

function ruleOfCall(callee: unknown) {
  if (isAstNode(callee) && callee.type === "Identifier" && typeof callee.name === "string") {
    return CALLED_FUNCTION_RULES.get(callee.name);
  }

  const methodName = memberPropertyName(callee);
  if (methodName === "addEventListener") {
    return SideEffectRule.EventListener;
  }

  const isExtensionListener = methodName === "addListener" && isAstNode(callee) && EXTENSION_EVENT_NAME.test(memberPropertyName(callee.object) ?? "");
  return isExtensionListener ? SideEffectRule.ExtensionListener : undefined;
}

function ruleOfNode(node: AstNode) {
  const isAwait = node.type === "AwaitExpression" || (node.type === "ForOfStatement" && node.await === true);
  if (isAwait) {
    return SideEffectRule.TopLevelAwait;
  }

  if (node.type === "CallExpression") {
    return ruleOfCall(node.callee);
  }

  if (node.type === "NewExpression") {
    const isMutationObserver = isAstNode(node.callee) && node.callee.name === "MutationObserver";
    return isMutationObserver ? SideEffectRule.MutationObserver : undefined;
  }

  const isMemberWrite = node.type === "AssignmentExpression" && memberPropertyName(node.left) !== undefined;
  const isGlobalWrite = isMemberWrite && node.type === "AssignmentExpression" && GLOBAL_OBJECTS.has(rootObjectName(node.left) ?? "");
  return isGlobalWrite ? SideEffectRule.GlobalWrite : undefined;
}

// An immediately invoked function runs at the top level, so its body counts
function immediatelyInvokedBody(node: AstNode) {
  const { callee } = node;
  const isCall = node.type === "CallExpression";
  if (!isCall) {
    return undefined;
  }

  if (!isAstNode(callee)) {
    return undefined;
  }

  return FUNCTION_NODE_TYPES.has(callee.type) ? callee.body : undefined;
}

function childNodes(node: AstNode) {
  return Object.values(node).flatMap(value => Array.isArray(value) ? value : [value]).filter(isAstNode);
}

function isSkippedNode(node: AstNode) {
  return FUNCTION_NODE_TYPES.has(node.type) || CLASS_NODE_TYPES.has(node.type);
}

// Depth-first over what runs at the top level: function and class bodies are skipped
function scan(root: AstNode) {
  const pending = [root];
  for (let node = pending.pop(); node; node = pending.pop()) {
    if (isSkippedNode(node)) {
      continue;
    }

    const rule = ruleOfNode(node);
    if (rule) {
      return {
        rule,
        start: node.start
      };
    }

    const invokedBody = immediatelyInvokedBody(node);
    const isInvoked = isAstNode(invokedBody);
    const children = isInvoked ? [invokedBody, ...childNodes(node).filter(child => child !== node.callee)] : childNodes(node);
    pending.push(...children.toReversed());
  }
  return undefined;
}

function lineOf({ source, offset }: { source: string; offset: number }) {
  return source.slice(0, offset).split("\n").length;
}

// The first top-level side effect of a TypeScript module, or undefined when re-evaluating it is safe
export function findSideEffect({ source, filename }: { source: string; filename: string }) {
  const program = parseAst(`${MODULE_MARKER}${source}`, { lang: filename.endsWith(FileExtension.Js) ? "js" : "ts" });
  for (const statement of program.body) {
    const found = scan({ ...statement });
    if (found) {
      return {
        rule: found.rule,
        line: lineOf({
          source,
          offset: found.start - MODULE_MARKER.length
        })
      } satisfies SideEffect;
    }
  }
  return undefined;
}

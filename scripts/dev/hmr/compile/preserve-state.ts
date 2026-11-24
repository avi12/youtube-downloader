/**
 * Ported from youtube-time-manager (scripts/hmr/preserve-state.ts): rewrites that carry `$state` across a
 * hot swap. Svelte 5 HMR recreates an edited component's whole subtree and a re-imported `.svelte.ts`
 * module re-runs its top level, so without these an edit resets an open dialog, a selected tab or a store.
 */

import { HMR_RUNTIME_GLOBAL } from "#scripts/dev/hmr/config.ts";

// Holds "how many OTHER instances of this component were already live" when this instance
// initialised, so restore() preserves only for a singleton recreation (0), never a multi-instance
// render (list rows would otherwise collide on a shared key).
const HMR_OTHERS_VAR = "ytdlHmrOtherInstances";

// The instance <script> open tag (not <script module> / <script context="module">), so the rewrite
// only touches per-instance UI state, never module-scope singletons (those go through the module
// transform).
const INSTANCE_SCRIPT_OPEN = /<script\b(?![^>]*\b(?:module|context)\b)[^>]*>/;

// A top-level `let/const X = $state(...)` / `$state.raw(...)`, capturing the variable name. Svelte
// only permits `$state` at the instance-script top level or as a class field, and a class field has
// no `const|let|var` keyword, so this regex naturally matches exactly the simple instance variables
// (destructured `$state` is skipped too - no carrying a stale value across a swap).
const INSTANCE_STATE_DECLARATION =
  /(?:^|\n)[ \t]*(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)[ \t]*=[ \t]*\$state(?:\.raw)?[ \t]*\(/g;

// Rewrite a component so its `$state` survives an HMR recreation: each init reads through the
// runtime's restore() and a save() effect writes it back, so a recreated instance re-reads its prior
// value (an open dialog stays open while a component under it is edited). Only primitives are actually preserved (save() drops object/ref keys), so
// DOM `bind:this` refs and lazy component refs re-init fresh. Best-effort: anything the regex/paren
// scan mishandles is caught by the compile fallback, so this can never make a component fail to build.
export function preserveLocalState({ code, componentId }: { code: string; componentId: string }) {
  const instanceScript = INSTANCE_SCRIPT_OPEN.exec(code);
  if (!instanceScript) {
    return code;
  }

  const contentStart = instanceScript.index + instanceScript[0].length;
  const contentEnd = code.indexOf("</script>", contentStart);
  if (contentEnd < 0) {
    return code;
  }

  const stateNames: string[] = [];
  const inserts: {
    position: number;
    text: string;
  }[] = [];
  for (const match of code.matchAll(INSTANCE_STATE_DECLARATION)) {
    const openParenIndex = match.index + match[0].length - 1;
    const isOutsideContent = openParenIndex < contentStart || openParenIndex > contentEnd;
    if (isOutsideContent) {
      continue;
    }

    const closeParenIndex = findMatchingParen({
      code,
      openParenIndex
    });
    if (closeParenIndex < 0) {
      continue;
    }

    const name = match[1];
    const key = JSON.stringify(`${componentId}:${name}`);
    const hasArgument = code.slice(openParenIndex + 1, closeParenIndex).trim().length > 0;
    if (hasArgument) {
      inserts.push({
        position: openParenIndex + 1,
        text: `globalThis.${HMR_RUNTIME_GLOBAL}.state.restore(${key}, ${HMR_OTHERS_VAR}, `
      });
      inserts.push({
        position: closeParenIndex,
        text: ")"
      });
    } else {
      inserts.push({
        position: openParenIndex + 1,
        text: `globalThis.${HMR_RUNTIME_GLOBAL}.state.restore(${key}, ${HMR_OTHERS_VAR}, undefined)`
      });
    }

    stateNames.push(name);
  }

  if (!stateNames.length) {
    return code;
  }

  inserts.push({
    position: contentStart,
    text: `\nconst ${HMR_OTHERS_VAR} = globalThis.${HMR_RUNTIME_GLOBAL}.state.enter(${JSON.stringify(componentId)});\n`
  });
  const saveEffects = stateNames
    .map(
      name => `$effect(() => { globalThis.${HMR_RUNTIME_GLOBAL}.state.save(${JSON.stringify(`${componentId}:${name}`)}, ${name}); });`
    )
    .join("\n");
  inserts.push({
    position: contentEnd,
    text: `\n${saveEffects}\n$effect(() => () => globalThis.${HMR_RUNTIME_GLOBAL}.state.exit(${JSON.stringify(componentId)}));\n`
  });

  return applyInserts({
    code,
    inserts
  });
}

// The index of the `)` that closes the `(` at openParenIndex, skipping over string/template literals
// so a paren inside a string doesn't unbalance the scan. Nested templates aren't fully modelled - a
// mis-scan just yields source the compile fallback catches.
function findMatchingParen({ code, openParenIndex }: { code: string; openParenIndex: number }) {
  let depth = 0;
  let openStringQuote = "";
  for (let i = openParenIndex; i < code.length; i++) {
    const char = code[i];
    if (openStringQuote) {
      if (char === "\\") {
        i++;
      } else if (char === openStringQuote) {
        openStringQuote = "";
      }

      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      openStringQuote = char;
    } else if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth--;

      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

// Apply a set of {position, text} inserts to `code`, splicing high offset to low so earlier positions
// stay valid as we go. Shared by both the component and module `$state`-preservation rewrites.
function applyInserts({
  code,
  inserts
}: {
  code: string;
  inserts: {
    position: number;
    text: string;
  }[];
}) {
  let result = code;
  for (const { position, text } of inserts.toSorted((left, right) => right.position - left.position)) {
    result = result.slice(0, position) + text + result.slice(position);
  }

  return result;
}

// A module-level `$state`/`$state.raw` declaration start, capturing the variable name.
const MODULE_STATE_DECLARATION =
  /(?:^|\n)[ \t]*(?:export[ \t]+)?(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)[ \t]*=[ \t]*\$state(?:\.raw)?[ \t]*\(/g;

// A module-level reactive instance - `new SvelteMap(...)`, `new SvelteSet(...)`, `createSubscriber(...)` -
// capturing the variable name and the callee.
const MODULE_REACTIVE_INSTANCE =
  /(?:^|\n)[ \t]*(?:export[ \t]+)?(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)[ \t]*=[ \t]*(new[ \t]+Svelte\w+(?:<[^()]*>)?|createSubscriber)[ \t]*\(/g;

// Only a simple single-declarator statement (next non-space after `)` is `;`, a newline or EOF);
// a multi-declarator `const a = $state(...), b = ...` is skipped to avoid mangling the rest.
const STATEMENT_END = /^[ \t]*(?:;|\r?\n|$)/;

// The edits that make one module-level declaration adopt the value of the first import. With
// `expressionStart`, the whole expression from there to its closing paren is adopted (a reactive
// instance holds its own subscribers, so a second one would split every reader of the first from every
// writer of the second); without it, only the argument of `$state(...)` is.
function adoptionEdits({ code, moduleId, variableName, openParenIndex, expressionStart }: {
  code: string;
  moduleId: string;
  variableName: string;
  openParenIndex: number;
  expressionStart?: number;
}) {
  const closeParenIndex = findMatchingParen({
    code,
    openParenIndex
  });
  const statementTail = closeParenIndex < 0 ? null : code.slice(closeParenIndex + 1).match(STATEMENT_END);
  if (!statementTail) {
    return [];
  }

  const key = JSON.stringify(`${moduleId}:${variableName}`);
  const adopt = `globalThis.${HMR_RUNTIME_GLOBAL}.state.adoptModuleState(${key}, () => `;
  // Adopting an argument opens two parens (`adoptModuleState(` and the `() => (` arrow body)
  const wrapEdits = expressionStart === undefined
    ? [{
      position: openParenIndex + 1,
      text: `${adopt}(`
    }, {
      position: closeParenIndex,
      text: "))"
    }]
    : [{
      position: expressionStart,
      text: adopt
    }, {
      position: closeParenIndex + 1,
      text: ")"
    }];
  return [
    ...wrapEdits,
    {
      position: closeParenIndex + 1 + statementTail[0].length,
      text: `\nglobalThis.${HMR_RUNTIME_GLOBAL}.state.rememberModuleState(${key}, ${variableName});\n`
    }
  ];
}

// Preserve module-level `$state` singletons (the popup app state and friends) across re-import. A
// `.svelte.ts` store module re-runs on every hot-swap; without this it builds a fresh empty store that
// the components still holding the old one never see. Each `export const X = $state(<init>)` becomes
// `$state(adoptModuleState(key, () => <init>))` plus a rememberModuleState(key, X), so the first proxy is
// reused on every later re-import - its data survives while the module's $derived recompute with their
// new logic. The compile fallback covers any case the regex/paren scan mishandles.
export function preserveModuleState({ code, moduleId }: { code: string; moduleId: string }) {
  const stateEdits = [...code.matchAll(MODULE_STATE_DECLARATION)].flatMap(match => adoptionEdits({
    code,
    moduleId,
    variableName: match[1],
    openParenIndex: match.index + match[0].length - 1
  }));
  const instanceEdits = [...code.matchAll(MODULE_REACTIVE_INSTANCE)].flatMap(match => {
    const [declaration, variableName, callee] = match;
    return adoptionEdits({
      code,
      moduleId,
      variableName,
      openParenIndex: match.index + declaration.length - 1,
      expressionStart: match.index + declaration.indexOf(callee, declaration.indexOf("="))
    });
  });
  const edits = [...stateEdits, ...instanceEdits];
  if (!edits.length) {
    return code;
  }

  return applyInserts({
    code,
    inserts: edits
  });
}

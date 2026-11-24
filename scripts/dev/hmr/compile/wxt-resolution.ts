// Resolves what only the WXT build knows - its path aliases, auto-imports and #imports barrel - for the
// standalone HMR build
import { SRC_PREFIX } from "#scripts/dev/hmr/config.ts";
import { PROJECT_ROOT } from "#scripts/dev/project.ts";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { z } from "zod";



const WXT_DIR = resolve(PROJECT_ROOT, ".wxt");
const VIRTUAL_PREFIX = "\0ytdl:";
const IMPORTS_VIRTUAL = `${VIRTUAL_PREFIX}wxt-imports`;
const STUB_VIRTUAL_PREFIX = `${VIRTUAL_PREFIX}stub:`;
const WXT_IMPORTS_SPECIFIER = "#imports";
const VIRTUAL_SPECIFIER_PREFIX = "virtual:";
export const CONTENT_ENTRY_PREFIX = `${VIRTUAL_PREFIX}content-entry:`;

// `#imports` is WXT's auto-import barrel, unresolvable outside the WXT build: provide its value
// re-exports here (mirrors .wxt/types/imports-module.d.ts, types dropped)
const WXT_IMPORTS_BARREL = [
  `export { browser } from "wxt/browser";`,
  `export { storage } from "wxt/utils/storage";`,
  `export { getAppConfig, useAppConfig } from "wxt/utils/app-config";`,
  `export { ContentScriptContext } from "wxt/utils/content-script-context";`,
  `export { createIframeUi } from "wxt/utils/content-script-ui/iframe";`,
  `export { createIntegratedUi } from "wxt/utils/content-script-ui/integrated";`,
  `export { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";`,
  `export { defineAppConfig } from "wxt/utils/define-app-config";`,
  `export { defineBackground } from "wxt/utils/define-background";`,
  `export { defineContentScript } from "wxt/utils/define-content-script";`,
  `export { defineUnlistedScript } from "wxt/utils/define-unlisted-script";`,
  `export { defineWxtPlugin } from "wxt/utils/define-wxt-plugin";`,
  `export { injectScript } from "wxt/utils/inject-script";`,
  `export { InvalidMatchPattern, MatchPattern } from "wxt/utils/match-patterns";`,
  `export { afterUpdate, beforeUpdate, createEventDispatcher, getAllContexts, getContext, hasContext, onDestroy, onMount, setContext, tick } from "svelte";`
].join("\n");

const AUTO_IMPORT_LINE = /const (\w+): typeof import\('([^']+)'\)\.(\w+)/g;
const IDENTIFIER_BOUNDARY = String.raw`(?<![\w$.])`;

function readAutoImports() {
  const declarations = readFileSync(join(WXT_DIR, "types", "imports.d.ts"), "utf-8");
  return [...declarations.matchAll(AUTO_IMPORT_LINE)].map(([, name, source, exported]) => ({
    name,
    source,
    exported
  }));
}

const tsconfigSchema = z.object({ compilerOptions: z.object({ paths: z.record(z.string(), z.array(z.string())) }) });

export function readPathAliases() {
  const { compilerOptions } = tsconfigSchema.parse(JSON.parse(readFileSync(join(WXT_DIR, "tsconfig.json"), "utf-8")));
  return Object.entries(compilerOptions.paths).map(([pattern, [target]]) => ({
    prefix: pattern.replace(/\*$/, ""),
    isWildcard: pattern.endsWith("*"),
    targetBase: resolve(WXT_DIR, target.replace(/\*$/, ""))
  }));
}

function sourceWithAutoImports({ code, autoImports }: {
  code: string;
  autoImports: ReturnType<typeof readAutoImports>;
}) {
  const missing = autoImports.filter(({ name }) => {
    const isUsed = new RegExp(`${IDENTIFIER_BOUNDARY}${name}\\b`).test(code);
    // Declared as a binding or imported by name - not merely used on the right of `const x = storage...`
    const isDeclared = new RegExp(String.raw`\b(?:const|let|var|function|class)\s+${name}\b|\bimport\b[^;]*?\b${name}\b[^;]*?\bfrom\b`).test(code);
    return isUsed && !isDeclared;
  });
  if (!missing.length) {
    return code;
  }

  const imports = missing.map(({ name, source, exported }) => `import { ${exported} as ${name} } from "${source}";`);
  return `${imports.join("\n")}\n${code}`;
}

export function wxtResolutionPlugin() {
  const aliases = readPathAliases();
  const autoImports = readAutoImports();
  return {
    name: "ytdl-wxt-resolution",
    enforce: "pre" as const,
    async resolveId(id: string, importer: string | undefined) {
      if (id.startsWith(CONTENT_ENTRY_PREFIX)) {
        return id;
      }

      if (id === WXT_IMPORTS_SPECIFIER) {
        return IMPORTS_VIRTUAL;
      }

      if (id.startsWith(VIRTUAL_SPECIFIER_PREFIX)) {
        return STUB_VIRTUAL_PREFIX + id;
      }

      const alias = aliases.find(({ prefix, isWildcard }) => isWildcard ? id.startsWith(prefix) : id === prefix.replace(/\/$/, ""));
      if (!alias) {
        return null;
      }

      const target = alias.isWildcard ? resolve(alias.targetBase, id.slice(alias.prefix.length)) : alias.targetBase;
      const resolution = await this.resolve(target, importer);
      return resolution?.id ?? null;
    },
    load(id: string) {
      if (id === IMPORTS_VIRTUAL) {
        return WXT_IMPORTS_BARREL;
      }

      if (id.startsWith(STUB_VIRTUAL_PREFIX)) {
        return "export default {};";
      }

      if (id.startsWith(CONTENT_ENTRY_PREFIX)) {
        const sourcePath = id.slice(CONTENT_ENTRY_PREFIX.length);
        return [
          `import definition from ${JSON.stringify(sourcePath)};`,
          `import { ContentScriptContext } from "wxt/utils/content-script-context";`,
          `export function run() { return definition.main(new ContentScriptContext("youtube", definition)); }`
        ].join("\n");
      }

      return null;
    },
    transform(code: string, id: string) {
      const isScript = /\.(?:ts|js)$/.test(id.split("?")[0]) && id.replaceAll("\\", "/").startsWith(SRC_PREFIX);
      if (!isScript) {
        return null;
      }

      return {
        code: sourceWithAutoImports({
          code,
          autoImports
        }),
        map: null
      };
    }
  } satisfies Plugin;
}

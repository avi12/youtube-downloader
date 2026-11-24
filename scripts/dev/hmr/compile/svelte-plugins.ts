import { HMR_RUNTIME_GLOBAL, srcIdOf } from "#scripts/dev/hmr/config.ts";
import type { GraphCollector } from "#scripts/dev/hmr/analysis/hot-sources.ts";
import { FileExtension } from "#scripts/dev/enums.ts";
import { PROJECT_ROOT } from "#scripts/dev/project.ts";
import { preserveLocalState, preserveModuleState } from "./preserve-state.ts";
import { relative } from "node:path";
import { compile, compileModule, preprocess } from "svelte/compiler";
import { type Plugin, transformWithOxc } from "vite";

const TYPESCRIPT_LANG = "ts";

export function toModuleId(absolutePath: string) {
  return relative(PROJECT_ROOT, absolutePath).replaceAll("\\", "/");
}

// Script blocks are stripped of TypeScript without dropping imports only the markup uses
async function stripTypescript({ content, attributes }: {
  content: string;
  attributes: Record<string, string | boolean>;
}) {
  if (attributes.lang !== TYPESCRIPT_LANG) {
    return { code: content };
  }

  const { code } = await transformWithOxc(content, "component.ts", {
    lang: "ts",
    typescript: {
       onlyRemoveTypeImports: true 
    }
  });
  return { code };
}

const sveltePreprocessor = { script: stripTypescript };
const HOT_CONTEXT_IDENTIFIER = "__ytdlHotContext";
const QUERY_SEPARATOR = "?";

// The $state rewrites are a best-effort regex transform, so source Svelte rejects falls back to the
// untouched code instead of failing the build
function compileWithFallback<TResult>({ compileSource, preservedCode, originalCode }: {
  compileSource: (source: string) => TResult;
  preservedCode: string;
  originalCode: string;
}) {
  try {
    return compileSource(preservedCode);
  } catch {
    return compileSource(originalCode);
  }
}

export function svelteHmrPlugin() {
  return {
    name: "ytdl-svelte-hmr",
    async transform(code: string, id: string) {
      const isSvelteModule = id.endsWith(FileExtension.SvelteTs) || id.endsWith(FileExtension.SvelteJs);
      if (isSvelteModule) {
        const jsCode = id.endsWith(FileExtension.Ts) ? (await transformWithOxc(code, id, { lang: "ts" })).code : code;
        const compiled = compileWithFallback({
          compileSource: source => compileModule(source, {
            filename: id,
            generate: "client",
            dev: true
          }),
          preservedCode: preserveModuleState({
            code: jsCode,
            moduleId: toModuleId(id)
          }),
          originalCode: jsCode
        });
        return {
          code: compiled.js.code,
          map: compiled.js.map
        };
      }

      if (!id.endsWith(FileExtension.Svelte)) {
        return null;
      }

      const processed = await preprocess(code, sveltePreprocessor, { filename: id });
      const { js } = compileWithFallback({
        compileSource: source => compile(source, {
          generate: "client",
          dev: true,
          hmr: true,
          css: "injected",
          filename: id
        }),
        preservedCode: preserveLocalState({
          code: processed.code,
          componentId: toModuleId(id)
        }),
        originalCode: processed.code
      });
      const rewritten = js.code.replaceAll("import.meta.hot", HOT_CONTEXT_IDENTIFIER);
      return {
        code: `const ${HOT_CONTEXT_IDENTIFIER} = globalThis.${HMR_RUNTIME_GLOBAL}.createHotContext(${JSON.stringify(toModuleId(id))});\n${rewritten}`,
        map: js.map
      };
    }
  } satisfies Plugin;
}

export function moduleGraphPlugin(graph: GraphCollector) {
  return {
    name: "ytdl-module-graph",
    buildEnd(this: { getModuleIds: () => Iterable<string>; getModuleInfo: (id: string) => { importers: readonly string[] } | null }) {
      for (const id of this.getModuleIds()) {
        const sourceId = srcIdOf(id);
        if (!sourceId) {
          continue;
        }

        graph.files.add(sourceId);

        if (!sourceId.endsWith(FileExtension.Css)) {
          continue;
        }

        if (id.includes(QUERY_SEPARATOR)) {
          graph.queriedCss.add(sourceId);
        }

        graph.cssImporters.set(sourceId, (this.getModuleInfo(id)?.importers ?? []).flatMap(importer => srcIdOf(importer) ?? []));
      }
    }
  } satisfies Plugin;
}

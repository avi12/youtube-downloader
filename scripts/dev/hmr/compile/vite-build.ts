import { HMR_ENTRIES, HmrEntryKind } from "#scripts/dev/hmr/config.ts";
import { createGraphCollector, type GraphCollector } from "#scripts/dev/hmr/analysis/hot-sources.ts";
import { BuildBrowser } from "#scripts/dev/enums.ts";
import { PROJECT_ROOT } from "#scripts/dev/project.ts";
import { moduleGraphPlugin, svelteHmrPlugin } from "./svelte-plugins.ts";
import { CONTENT_ENTRY_PREFIX, readPathAliases, wxtResolutionPlugin } from "./wxt-resolution.ts";
import { join, resolve } from "node:path";
import { build, loadEnv } from "vite";

const MAIN_WORLD_ENTRY = "src/layers/youtube/entrypoints/youtube-main.content/index.ts";
const NODE_ENV_DEVELOPMENT = "development";

export function entryInputs() {
  return Object.fromEntries(
           HMR_ENTRIES.map(entry => [
    entry.name,
    entry.kind === HmrEntryKind.ContentScript
      ? `${CONTENT_ENTRY_PREFIX}${resolve(PROJECT_ROOT, entry.sourcePath).replaceAll("\\", "/")}`
      : resolve(PROJECT_ROOT, entry.sourcePath)
  ])
         );
}

export async function runViteBuild({ input, browser, outputDirectory, graph, isWrite }: {
  input: Record<string, string>;
  browser: BuildBrowser;
  outputDirectory: string;
  graph: GraphCollector;
  isWrite: boolean;
}) {
  // Vite decides import.meta.* replacement from NODE_ENV; force development for this build only
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = NODE_ENV_DEVELOPMENT;
  const envDefines = Object.fromEntries(
    Object.entries(loadEnv(NODE_ENV_DEVELOPMENT, PROJECT_ROOT, "WXT_")).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])
  );
  try {
    return await build({
      configFile: false,
      root: PROJECT_ROOT,
      mode: NODE_ENV_DEVELOPMENT,
      logLevel: "error",
      define: {
        ...envDefines,
        "import.meta.env.BROWSER": JSON.stringify(browser),
        "import.meta.env.FIREFOX": JSON.stringify(browser === BuildBrowser.Firefox),
        "import.meta.env.CHROME": JSON.stringify(browser === BuildBrowser.Chrome),
        "import.meta.env.MANIFEST_VERSION": "3"
      },
      resolve: {
        conditions: ["browser", NODE_ENV_DEVELOPMENT],
        // CSS `@import` goes through Vite's own resolver, which doesn't see the plugin's resolveId
        alias: readPathAliases().filter(({ isWildcard }) => isWildcard).map(({ prefix, targetBase }) => ({
          find: prefix,
          replacement: `${targetBase.replaceAll("\\", "/")}/`
        }))
      },
      plugins: [wxtResolutionPlugin(), svelteHmrPlugin(), moduleGraphPlugin(graph)],
      build: {
        write: isWrite,
        minify: false,
        outDir: outputDirectory,
        emptyOutDir: false,
        // A content script resolves Vite's preload hrefs against youtube.com, so every one 404s
        modulePreload: false,
        rollupOptions: {
          input,
          preserveEntrySignatures: "exports-only",
          output: {
            format: "es",
            // One module per source file, so a single component re-imports without the rest
            preserveModules: true,
            preserveModulesRoot: PROJECT_ROOT,
            entryFileNames: "[name].js",
            chunkFileNames: "[name].js",
            assetFileNames: "assets/[name][extname]"
          }
        }
      }
    });
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
}

// The MAIN-world script runs outside the HMR runtime, so a component it also mounts can't swap there
export async function collectMainWorldModules(browser: BuildBrowser) {
  const graph = createGraphCollector();
  await runViteBuild({
    input: {
       main: resolve(PROJECT_ROOT, MAIN_WORLD_ENTRY) 
    },
    browser,
    outputDirectory: join(PROJECT_ROOT, "node_modules", ".cache", "ytdl-hmr-main-world"),
    graph,
    isWrite: false
  });
  return graph.files;
}

export function toChunks(built: Awaited<ReturnType<typeof runViteBuild>>) {
  const outputs = Array.isArray(built) ? built : [built];
  return outputs.flatMap(output => "output" in output ? output.output : []);
}

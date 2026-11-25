// The only Node left in the HMR build: Vite bundles and the Svelte compiler compiles, neither of which
// has a Rust equivalent. The process stays alive between builds: one JSON job arrives per build, the
// `$state` rewrites and the WXT auto-import scan are asked of the Rust side as request lines, and a
// final line reports the result. Transforms are cached by file and content, so a build after an edit
// only recompiles what changed.
import { createInterface } from "node:readline";
import { relative, resolve } from "node:path";
import { build, loadEnv, transformWithOxc } from "vite";
import { compile, compileModule, preprocess } from "svelte/compiler";

console.log = console.error;
const lines = createInterface({ input: process.stdin });
let job;
const pending = new Map();
let nextId = 0;
const transformCache = new Map();
let cacheEpoch;

function send(message) {
  return new Promise(done => process.stdout.write(
                               `${JSON.stringify(message)}
`, done
                             ));
}

function ask(request) {
  return new Promise(answer => {
    const id = nextId++;
    pending.set(id, answer);
    send({
       type: "request",
       id,
       request 
    }).catch(reportBrokenPipe);
  });
}

function reportBrokenPipe(error) {
  console.error("[worker] the Rust side closed the pipe", error);
  process.exit(1);
}

async function cached({ key, produce }) {
  if (transformCache.has(key)) {return transformCache.get(key);}

  const value = await produce();
  transformCache.set(key, value);
  return value;
}

function toModuleId(absolutePath) {
  return relative(job.projectRoot, absolutePath).replaceAll("\\", "/");
}

function withoutQuery(id) {
  return id.split("?")[0];
}

function wxtResolutionPlugin() {
  const { virtualModules: virtual, aliases } = job;
  return {
    name: "ytdl-wxt-resolution",
    enforce: "pre",
    async resolveId(id, importer) {
      if (id.startsWith(virtual.contentEntryPrefix)) {return id;}

      if (id === virtual.importsSpecifier) {return virtual.importsId;}

      if (id.startsWith(virtual.stubSpecifierPrefix)) {return virtual.stubIdPrefix + id;}

      // Only `src` gets the stand-in, which itself imports the real package
      const isSourceImporter = importer?.replaceAll("\\", "/").startsWith(job.srcPrefix);
      const isTrackedImport = isSourceImporter && Object.hasOwn(virtual.trackedImports, id);
      if (isTrackedImport) {return virtual.trackedImports[id];}

      const alias = aliases.find(({ prefix, isWildcard }) => isWildcard ? id.startsWith(prefix) : id === prefix.replace(/\/$/, ""));
      if (!alias) {return null;}

      const target = alias.isWildcard ? resolve(alias.targetBase, id.slice(alias.prefix.length)) : alias.targetBase;
      return (await this.resolve(target, importer))?.id ?? null;
    },
    load(id) {
      if (id.startsWith(virtual.stubIdPrefix)) {return "export default {};";}

      return virtual.modules[id] ?? null;
    },
    async transform(code, id) {
      const isScript = /\.(?:ts|js)$/.test(withoutQuery(id)) && id.replaceAll("\\", "/").startsWith(job.srcPrefix);
      if (!isScript) {return null;}

      const withImports = await cached({
        key: `imports:${id}:${code}`,
        produce: () => ask({
           op: "autoImports",
           code 
        })
      });
      return {
         code: withImports,
         map: null 
      };
    }
  };
}

async function stripTypescript({ content, attributes }) {
  if (attributes.lang !== "ts") {return { code: content };}

  const { code } = await transformWithOxc(content, "component.ts", {
     lang: "ts",
     typescript: {
     onlyRemoveTypeImports: true 
  } 
  });
  return { code };
}

// The $state rewrites are best effort, so source Svelte rejects falls back to the untouched code
function compileWithFallback({ compileSource, preservedCode, originalCode }) {
  try {
    return compileSource(preservedCode);
  } catch {
    return compileSource(originalCode);
  }
}

async function transformSvelte({ code, id }) {
      const isModuleSource = id.endsWith(".svelte.ts") || id.endsWith(".svelte.js");
      if (isModuleSource) {
        const jsCode = id.endsWith(".ts") ? (await transformWithOxc(code, id, { lang: "ts" })).code : code;
        const compiled = compileWithFallback({
          compileSource: source => compileModule(source, {
             filename: id,
             generate: "client",
             dev: true 
          }),
          preservedCode: await ask({
             op: "preserveModule",
             code: jsCode,
             key: toModuleId(id) 
          }),
          originalCode: jsCode
        });
        return {
           code: compiled.js.code,
           map: compiled.js.map 
        };
      }

      if (!id.endsWith(".svelte")) {return null;}

      const processed = await preprocess(code, { script: stripTypescript }, { filename: id });
      const { js } = compileWithFallback({
        compileSource: source => compile(source, {
           generate: "client",
           dev: true,
           hmr: true,
           css: "injected",
           filename: id 
        }),
        preservedCode: await ask({
           op: "preserveLocal",
           code: processed.code,
           key: toModuleId(id) 
        }),
        originalCode: processed.code
      });
      const rewritten = js.code.replaceAll("import.meta.hot", "__ytdlHotContext");
      return {
        code: `const __ytdlHotContext = globalThis.${job.runtimeGlobal}.createHotContext(${JSON.stringify(toModuleId(id))});\n${rewritten}`,
        map: js.map
      };
}

function svelteHmrPlugin() {
  return {
    name: "ytdl-svelte-hmr",
    transform(code, id) {
      const isSvelteSource = id.endsWith(".svelte.ts") || id.endsWith(".svelte.js") || id.endsWith(".svelte");
      return isSvelteSource ? cached({
         key: `svelte:${id}:${code}`,
         produce: () => transformSvelte({
         code,
         id 
      }) 
      }) : null;
    }
  };
}

let modules = [];
const moduleGraphPlugin = {
  name: "ytdl-module-graph",
  buildEnd() {
    for (const id of this.getModuleIds()) {modules.push({
       id,
       importers: [...this.getModuleInfo(id)?.importers ?? []] 
    });}
  }
};

function describeAsset({ type, fileName, source }) {
  const isText = typeof source === "string";
  return {
     type,
     fileName,
     source: isText ? source : Buffer.from(source).toString("base64"),
     isSourceBase64: !isText 
  };
}

function describeChunk(chunk) {
  if (chunk.type !== "chunk") {return describeAsset(chunk);}

  const { type, name, fileName, isEntry, facadeModuleId, moduleIds, imports, dynamicImports, code } = chunk;
  return {
     type,
     name,
     fileName,
     isEntry,
     facadeModuleId,
     moduleIds,
     imports,
     dynamicImports,
     code 
  };
}

async function run() {
  const envDefines = Object.fromEntries(
    Object.entries(loadEnv(job.mode, job.projectRoot, "WXT_")).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])
  );
  const built = await build({
    configFile: false,
    root: job.projectRoot,
    mode: job.mode,
    logLevel: "error",
    define: {
      ...envDefines,
      "import.meta.env.BROWSER": JSON.stringify(job.browser),
      "import.meta.env.FIREFOX": JSON.stringify(job.browser === "firefox"),
      "import.meta.env.CHROME": JSON.stringify(job.browser === "chrome"),
      "import.meta.env.MANIFEST_VERSION": "3"
    },
    resolve: {
      conditions: ["browser", job.mode],
      // CSS `@import` goes through Vite's own resolver, which doesn't see the plugin's resolveId
      alias: job.aliases.filter(({ isWildcard }) => isWildcard).map(({ prefix, targetBase }) => ({
         find: prefix,
         replacement: `${targetBase}/` 
      }))
    },
    plugins: [wxtResolutionPlugin(), svelteHmrPlugin(), moduleGraphPlugin],
    build: {
      write: false,
      minify: false,
      outDir: job.outputDirectory,
      emptyOutDir: false,
      // A content script resolves Vite's preload hrefs against youtube.com, so every one 404s
      modulePreload: false,
      rollupOptions: {
        input: job.input,
        preserveEntrySignatures: "exports-only",
        output: {
          format: "es",
          // One module per source file, so a single component re-imports without the rest
          preserveModules: true,
          preserveModulesRoot: job.projectRoot,
          entryFileNames: "[name].js",
          chunkFileNames: "[name].js",
          assetFileNames: "assets/[name][extname]"
        }
      }
    }
  });
  const outputs = Array.isArray(built) ? built : [built];
  return {
     chunks: outputs.flatMap(output => "output" in output ? output.output : []).map(describeChunk),
     modules 
  };
}

async function runJob() {
  modules = [];

  if (job.cacheEpoch !== cacheEpoch) {transformCache.clear();}

  cacheEpoch = job.cacheEpoch;
  try {
    await send({
       type: "done",
       output: await run() 
    });
  } catch (error) {
    await send({
       type: "failed",
       message: String(error?.stack ?? error) 
    });
  }
}

// One build at a time: a job line starts a build, every other line answers a request of it
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.projectRoot === undefined) {
    pending.get(message.id)?.(message.code);
    pending.delete(message.id);
    continue;
  }

  job = message;
  runJob().catch(reportBrokenPipe);
}

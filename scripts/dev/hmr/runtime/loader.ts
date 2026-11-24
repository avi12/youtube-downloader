/**
 * Turns the in-browser runtimes into the scripts the dev build ships: runtime.ts (the page and content
 * script HMR runtime, imported as an ES module with its config prepended) and background-prelude.ts
 * (prepended to the background script, wrapped so evaluating it again redeclares nothing). Neither has
 * imports, so a TypeScript strip is all they need.
 */

import { HMR_MANIFEST_FILE, HMR_OUT_SUBDIR, HMR_POLL_INTERVAL_MS } from "#scripts/dev/hmr/config.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { transformWithOxc } from "vite";

const RuntimeSourceFile = {
  Page: "runtime.ts",
  BackgroundPrelude: "background-prelude.ts"
} as const;
type RuntimeSourceFile = (typeof RuntimeSourceFile)[keyof typeof RuntimeSourceFile];

async function transpileRuntime(fileName: RuntimeSourceFile) {
  const source = readFileSync(join(import.meta.dirname, fileName), "utf-8");
  const { code } = await transformWithOxc(source, fileName, { lang: "ts" });
  return code;
}

export async function buildRuntimeSource() {
  const config = {
    manifestPath: `${HMR_OUT_SUBDIR}/${HMR_MANIFEST_FILE}`,
    pollIntervalMs: HMR_POLL_INTERVAL_MS
  };
  return `const HMR_CONFIG = ${JSON.stringify(config)};\n${await transpileRuntime(RuntimeSourceFile.Page)}`;
}

export async function buildBackgroundPrelude() {
  return `(() => {\n${await transpileRuntime(RuntimeSourceFile.BackgroundPrelude)}\n})();\n`;
}

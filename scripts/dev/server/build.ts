import { addHmrWebAccessibleResources, addRecorderContentScript, patchBuiltOutput } from "#scripts/dev/output/patches.ts";
import { buildHmrModules } from "#scripts/dev/hmr/compile/build.ts";
import { buildBackgroundPrelude, buildRuntimeSource } from "#scripts/dev/hmr/runtime/loader.ts";
import { BuildBrowser } from "#scripts/dev/enums.ts";
import { PROJECT_ROOT } from "#scripts/dev/project.ts";
import { logEvent } from "./log.ts";
import { DEV_ONLY_PERMISSION, IS_FIREFOX, OUT_DIR } from "./options.ts";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "wxt";

// ── Build ───────────────────────────────────────────────────────────────────

async function buildExtension() {
  let outputDir: string | undefined;
  const backgroundPrelude = await buildBackgroundPrelude();
  await build({
    root: PROJECT_ROOT,
    browser: IS_FIREFOX ? BuildBrowser.Firefox : BuildBrowser.Chrome,
    ...OUT_DIR ? { outDir: OUT_DIR } : {},
    // WXT merges these over wxt.config.ts's hooks by name, so they must stay on hooks the config
    // doesn't define - an inline build:publicAssets would silently drop its ffmpeg/LICENSE copies
    hooks: {
      "build:manifestGenerated"(_wxt, manifest) {
        manifest.permissions = [...new Set([...manifest.permissions ?? [], DEV_ONLY_PERMISSION])];
        manifest.content_scripts = addRecorderContentScript(manifest.content_scripts ?? []);
        manifest.web_accessible_resources = addHmrWebAccessibleResources(manifest.web_accessible_resources ?? []);
      },
      "build:done"(wxt) {
        outputDir = wxt.config.outDir;
        patchBuiltOutput({
          outputDir,
          backgroundPrelude
        });
      }
    }
  });

  if (!outputDir) {
    throw new Error("WXT finished without reporting its output directory");
  }

  return outputDir;
}

// The browser serves extension files straight off the output dir and briefly holds them open
// without FILE_SHARE_DELETE, so a rebuild's cleanup can hit a transient Windows lock. Builds are
// idempotent, so retry those; anything else (a mid-edit syntax error) fails at once.
const TRANSIENT_FS_ERROR_PATTERN = /EPERM|EBUSY/;
const MAX_BUILD_ATTEMPTS = 3;
const BUILD_RETRY_DELAY_MS = 300;

function isRetryableBuildError({ error, attempt }: {
  error: unknown;
  attempt: number;
}) {
  return TRANSIENT_FS_ERROR_PATTERN.test(String(error)) && attempt < MAX_BUILD_ATTEMPTS;
}

export async function buildWithLockRetry() {
  for (let attempt = 1; ; attempt++) {
    const outcome = await buildExtension().then(
      outputDir => ({ outputDir }),
      (error: unknown) => ({ error })
    );
    if ("outputDir" in outcome) {
      return outcome.outputDir;
    }

    if (!isRetryableBuildError({
      error: outcome.error,
      attempt
    })) {
      throw outcome.error;
    }

    logEvent(`Build hit a transient file lock (attempt ${attempt}/${MAX_BUILD_ATTEMPTS}) - retrying`);
    await delay(BUILD_RETRY_DELAY_MS);
  }
}

// The hot-swappable entrypoints run from these modules (see output/patches.ts), so every WXT build,
// which empties the output dir, is followed by this
export async function buildHmr(outputDir: string) {
  const { manifest, reloadLogs } = await buildHmrModules({
    outputDir,
    browser: IS_FIREFOX ? BuildBrowser.Firefox : BuildBrowser.Chrome,
    runtimeSource: await buildRuntimeSource()
  });
  for (const line of reloadLogs) {
    logEvent(line);
  }
  return manifest;
}

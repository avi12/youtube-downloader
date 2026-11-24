import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";

import { z } from "zod";

import type {
  ChangedOutputs,
  EntrypointLayout,
  HostRequest,
  Notification,
  OutboundMessage,
  RebuildHmrResult,
  ReloadExtensionParams,
  RequestEnvelope,
  Response,
  SidecarConfig
} from "#dev-server/bindings/index.ts";

const DEV_SERVER_DIRECTORY = resolve(import.meta.dirname, "..", "dev-server");
const CARGO_MANIFEST_PATH = resolve(DEV_SERVER_DIRECTORY, "Cargo.toml");
const BINARY_FILE_NAME = process.platform === "win32" ? "ytdl-dev-hot.exe" : "ytdl-dev-hot";
const PREBUILT_BINARY_PATH = resolve(DEV_SERVER_DIRECTORY, "target", "release", BINARY_FILE_NAME);
const SIDECAR_SHUTDOWN_GRACE_MS = 3000;
const SIDECAR_SOURCE_PATHS = ["src", "Cargo.toml", "Cargo.lock"];

// The wire types are generated from the Rust sidecar (dev-server/bindings, by ts-rs); these schemas
// only validate what arrives on stdout, and `z.ZodType<T>` fails to compile when they drift from it
type HostMethod = HostRequest["method"];

const HostMethod = {
  BuildExtension: "buildExtension",
  RebuildHmr: "rebuildHmr",
  ReloadExtension: "reloadExtension",
  InjectHmr: "injectHmr",
  RefreshEnv: "refreshEnv"
} as const satisfies Record<string, HostMethod>;

const SHUTDOWN_NOTIFICATION: Notification = { notify: "shutdown" };

const requestIdSchema = z.number().int().nonnegative();

const changedOutputsSchema: z.ZodType<ChangedOutputs> = z.object({
  isBackgroundChanged: z.boolean(),
  changedContentScriptFiles: z.array(z.string()),
  isMainWorldContentScriptChanged: z.boolean()
});

const reloadExtensionParamsSchema: z.ZodType<ReloadExtensionParams> = z.object({
  changed: changedOutputsSchema,
  startedAtMs: z.number().int().nonnegative()
});

const requestEnvelopeSchema: z.ZodType<RequestEnvelope> = z.discriminatedUnion("method", [
  z.object({
    id: requestIdSchema,
    method: z.literal(HostMethod.BuildExtension)
  }),
  z.object({
    id: requestIdSchema,
    method: z.literal(HostMethod.RebuildHmr)
  }),
  z.object({
    id: requestIdSchema,
    method: z.literal(HostMethod.ReloadExtension),
    params: reloadExtensionParamsSchema
  }),
  z.object({
    id: requestIdSchema,
    method: z.literal(HostMethod.InjectHmr)
  }),
  z.object({
    id: requestIdSchema,
    method: z.literal(HostMethod.RefreshEnv)
  })
]);

const outboundMessageSchema: z.ZodType<OutboundMessage> = z.union([
  requestEnvelopeSchema,
  z.object({ log: z.string() })
]);

export type { EntrypointLayout, ReloadExtensionParams, SidecarConfig };

export interface HotSidecarHandlers {
  buildExtension: () => Promise<EntrypointLayout | undefined>;
  rebuildHmr: () => Promise<RebuildHmrResult>;
  // Resolves whatever it likes (web-ext-run resolves an array) - the bridge answers null regardless
  reloadExtension: (params: ReloadExtensionParams) => Promise<unknown>;
  injectHmr: () => Promise<boolean>;
  refreshEnv: () => Promise<unknown>;
}

function newestModifiedTime(path: string) {
  const entries = statSync(path).isDirectory()
    ? readdirSync(path, { recursive: true }).map(entry => join(path, String(entry)))
    : [path];
  return Math.max(...entries.map(entry => statSync(entry).mtimeMs));
}

function isSidecarBinaryStale() {
  if (!existsSync(PREBUILT_BINARY_PATH)) {
    return true;
  }

  const sourcesModifiedAt = Math.max(
    ...SIDECAR_SOURCE_PATHS.map(source => newestModifiedTime(join(DEV_SERVER_DIRECTORY, source)))
  );
  return sourcesModifiedAt > statSync(PREBUILT_BINARY_PATH).mtimeMs;
}

// Builds the sidecar once when it is missing or older than its sources. Cargo can be slow the first
// time, so it prints one line first and streams cargo's own output.
function ensureSidecarBinary(onLog: (message: string) => void) {
  if (!isSidecarBinaryStale()) {
    return;
  }

  onLog("Building the hot sidecar (cargo build --release) - the first build takes a while...");
  const { status, error } = spawnSync("cargo", ["build", "--release", "--manifest-path", CARGO_MANIFEST_PATH], {
    stdio: "inherit"
  });
  if (status !== 0) {
    throw new Error(`cargo build of the hot sidecar failed (${error?.message ?? `exit code ${status}`})`);
  }
}

interface SidecarCommand {
  command: string;
  args: string[];
}

const BUILT_SIDECAR: SidecarCommand = {
  command: PREBUILT_BINARY_PATH,
  args: []
};

function parseJsonLine(line: string) {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

// The calls that answer nothing reply null whatever their handler returns: web-ext-run's
// reloadAllExtensions resolves an array of per-extension results, which the sidecar rejects
async function dispatchRequest({ request, handlers }: { request: HostRequest; handlers: HotSidecarHandlers }) {
  switch (request.method) {
    case HostMethod.BuildExtension:
      return handlers.buildExtension();
    case HostMethod.RebuildHmr:
      return handlers.rebuildHmr();
    case HostMethod.ReloadExtension:
      await handlers.reloadExtension(request.params);
      return null;
    case HostMethod.InjectHmr:
      return handlers.injectHmr();
    case HostMethod.RefreshEnv:
      await handlers.refreshEnv();
      return null;
  }
}

async function answerRequest({ request, handlers }: {
  request: RequestEnvelope;
  handlers: HotSidecarHandlers;
}) {
  try {
    const result = await dispatchRequest({
      request,
      handlers
    });
    return {
      id: request.id,
      result: result ?? null
    } satisfies Response;
  } catch (error) {
    return {
      id: request.id,
      error: error instanceof Error ? error.message : String(error)
    } satisfies Response;
  }
}

export function startHotSidecar({
  config,
  handlers,
  onLog = console.log,
  sidecar
}: {
  config: SidecarConfig;
  handlers: HotSidecarHandlers;
  onLog?: (message: string) => void;
  sidecar?: SidecarCommand;
}) {
  if (!sidecar) {
    ensureSidecarBinary(onLog);
  }

  const { command, args } = sidecar ?? BUILT_SIDECAR;
  const child = spawn(command, args, {
    stdio: ["pipe", "pipe", "inherit"],
    cwd: DEV_SERVER_DIRECTORY
  });
  const exited = new Promise<number | null>(resolveExit => child.once("exit", resolveExit));
  child.once("error", error => onLog(`Hot sidecar failed to start: ${error.message}`));

  function send(message: SidecarConfig | Response | Notification) {
    if (!child.stdin.writable) {
      return;
    }

    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async function handleLine(line: string) {
    const parsed = outboundMessageSchema.safeParse(parseJsonLine(line));
    if (!parsed.success) {
      onLog(`Hot sidecar sent an unknown message: ${line}`);
      return;
    }

    if ("log" in parsed.data) {
      onLog(parsed.data.log);
      return;
    }

    send(
      await answerRequest({
        request: parsed.data,
        handlers
      })
    );
  }

  createInterface({ input: child.stdout }).on("line", handleLine);
  send(config);

  async function shutdown() {
    send(SHUTDOWN_NOTIFICATION);
    child.stdin.end();
    const exitCode = await Promise.race([exited, delay(SIDECAR_SHUTDOWN_GRACE_MS, "timeout" as const)]);
    if (exitCode === "timeout") {
      child.kill();
    }
  }

  return {
    shutdown,
    exited
  };
}

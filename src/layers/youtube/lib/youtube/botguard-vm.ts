import { botGuardVmEntrySchema, trustedResourceUrlSchema } from "@/lib/youtube/schemas";
import type { z } from "@/lib/zod";
import { createGuard } from "@/lib/zod-guard";
import type { Prettify } from "@/types";

const VM_POLL_INTERVAL_MS = 500;
const VM_POLL_MAX_ATTEMPTS = 60;

const isBotGuardVmEntry = createGuard(botGuardVmEntrySchema);

export function getBotGuardVm(name: string) {
  const globals: Record<string, unknown> = globalThis;
  const entry = globals[name];
  return isBotGuardVmEntry(entry) ? entry : null;
}

async function loadInterpreterScript(interpreterUrl: string) {
  await new Promise<void>((resolve, reject) => {
    const elScript = document.createElement("script");
    elScript.src = new URL(interpreterUrl, location.href).href;
    elScript.onload = () => resolve();
    elScript.onerror = () => reject(new Error("Failed to load BotGuard interpreter"));
    document.head.append(elScript);
  });
}

type EnsureBotGuardVmParams = Prettify<{
  globalName: string;
  interpreterUrlRaw: unknown;
}>;
export async function ensureBotGuardVm({ globalName, interpreterUrlRaw }: EnsureBotGuardVmParams) {
  const isVmAlreadyLoaded = Boolean(getBotGuardVm(globalName));
  if (isVmAlreadyLoaded) {
    return;
  }

  const interpreterUrl = typeof interpreterUrlRaw === "string"
    ? interpreterUrlRaw
    : trustedResourceUrlSchema.safeParse(interpreterUrlRaw).data
      ?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
  if (interpreterUrl) {
    await loadInterpreterScript(interpreterUrl);
  }

  for (let attempt = 0; attempt < VM_POLL_MAX_ATTEMPTS; attempt++) {
    const isVmLoaded = Boolean(getBotGuardVm(globalName));
    if (isVmLoaded) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, VM_POLL_INTERVAL_MS));
  }
}

export type SignalFunction = (input: Uint8Array) => Promise<(input: Uint8Array) => Promise<Uint8Array>>;

type InitBotGuardVmParams = Prettify<{
  botGuardEntry: z.infer<typeof botGuardVmEntrySchema>;
  program: string;
  webPoSignalOutput: SignalFunction[];
}>;
export function initBotGuardVm({ botGuardEntry, program, webPoSignalOutput }: InitBotGuardVmParams) {
  const initResult = botGuardEntry.a(program, () => {}, true, undefined, () => {}, [[], []]);
  const snapshotFunction = initResult?.[0];
  const isSnapshotMissing = typeof snapshotFunction !== "function";
  if (isSnapshotMissing) {
    throw new Error("BotGuard snapshot function not available");
  }

  const snapshotResponse = snapshotFunction.call(null, [undefined, undefined, webPoSignalOutput, undefined]);
  const isResponseEmpty = !snapshotResponse;
  if (isResponseEmpty) {
    throw new Error("Empty snapshot response");
  }

  return snapshotResponse;
}

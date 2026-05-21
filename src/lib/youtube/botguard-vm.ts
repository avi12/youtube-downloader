const VM_POLL_INTERVAL_MS = 500;
const VM_POLL_MAX_ATTEMPTS = 60;

interface BotGuardVmEntry {
  a: (...args: unknown[]) => [((inputs: unknown[]) => string | null)?] | null | undefined;
}

function isBotGuardVmEntry(value: unknown): value is BotGuardVmEntry {
  const isObject = typeof value === "object";
  const isNotNull = value !== null;
  const isNonNullObject = isObject && isNotNull;
  if (!isNonNullObject) {
    return false;
  }

  const hasAKey = "a" in value;
  if (!hasAKey) {
    return false;
  }

  return typeof value.a === "function";
}

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

type EnsureBotGuardVmParams = {
  globalName: string;
  interpreterUrlRaw: string | {
    privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: string;
  } | undefined;
};
export async function ensureBotGuardVm({ globalName, interpreterUrlRaw }: EnsureBotGuardVmParams) {
  const isVmAlreadyLoaded = Boolean(getBotGuardVm(globalName));
  if (isVmAlreadyLoaded) {
    return;
  }

  const interpreterUrl =
    typeof interpreterUrlRaw === "string"
      ? interpreterUrlRaw
      : interpreterUrlRaw?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
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

type InitBotGuardVmParams = {
  botGuardEntry: BotGuardVmEntry;
  program: string;
  webPoSignalOutput: SignalFunction[];
};
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

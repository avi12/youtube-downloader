const VM_POLL_INTERVAL_MS = 500;
const VM_POLL_MAX_ATTEMPTS = 60;

interface BotGuardVmEntry {
  a: (...args: unknown[]) => [((inputs: unknown[]) => string | null)?] | null | undefined;
}

function isBotGuardVmEntry(value: unknown): value is BotGuardVmEntry {
  return (
    typeof value === "object"
    && value !== null
    && "a" in value
    && typeof value.a === "function"
  );
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

export async function ensureBotGuardVm(globalName: string, interpreterUrlRaw: string | {
  privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: string;
} | undefined) {
  if (getBotGuardVm(globalName)) {
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
    if (getBotGuardVm(globalName)) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, VM_POLL_INTERVAL_MS));
  }
}

export type SignalFn = (input: Uint8Array) => Promise<(input: Uint8Array) => Promise<Uint8Array>>;

export function initBotGuardVm(botGuardEntry: BotGuardVmEntry, program: string, webPoSignalOutput: SignalFn[]) {
  const initResult = botGuardEntry.a(program, () => {}, true, undefined, () => {}, [[], []]);
  const snapshotFn = initResult?.[0];
  if (typeof snapshotFn !== "function") {
    throw new Error("BotGuard snapshot function not available");
  }

  const snapshotResponse = snapshotFn.call(null, [undefined, undefined, webPoSignalOutput, undefined]);
  if (!snapshotResponse) {
    throw new Error("Empty snapshot response");
  }

  return snapshotResponse;
}

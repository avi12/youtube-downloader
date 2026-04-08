/**
 * Generates YouTube PO (Proof of Origin) tokens using the sync
 * BotGuard snapshot. Runs directly in the MAIN world content script.
 *
 * Uses YouTube's existing BotGuard VM (loaded on the page) with
 * the synchronous snapshot function to avoid async callback issues.
 */

const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
const GOOG_API_KEY = "AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw";

declare const ytcfg: { get(key: string): unknown } | undefined;

interface ChallengeResponse {
  bgChallenge?: {
    program: string;
    globalName: string;
    interpreterUrl: string | { privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: string };
  };
}

export async function generatePoToken(videoId: string) {
  const clientVersion = typeof ytcfg !== "undefined"
    ? String(ytcfg.get("INNERTUBE_CLIENT_VERSION") ?? "2.20260401.01.00")
    : "2.20260401.01.00";

  // Step 1: Fetch challenge
  const challengeResponse = await fetch(
    "https://www.youtube.com/youtubei/v1/att/get?prettyPrint=false",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        engagementType: "ENGAGEMENT_TYPE_UNBOUND",
        context: {
          client: {
            clientName: "WEB",
            clientVersion
          }
        }
      })
    }
  );

  const challengeData: ChallengeResponse = await challengeResponse.json();
  const program = challengeData.bgChallenge?.program;
  const globalName = challengeData.bgChallenge?.globalName;
  if (!program || !globalName) {
    throw new Error("No BotGuard challenge data received");
  }

  // Step 2: Wait for YouTube's BotGuard VM, loading the interpreter if needed.
  // On watch pages YouTube pre-loads BotGuard; on other pages (subscriptions,
  // homepage) it doesn't, so we load the interpreter script ourselves.
  // BotGuard is YouTube's undocumented anti-bot runtime with a fully dynamic
  // shape that can't be statically typed.
  function getBotGuardVm(name: string) {
    const entry = Object.getOwnPropertyDescriptor(globalThis, name)?.value;
    return entry !== null && typeof entry === "object" && "a" in entry ? entry : null;
  }

  if (!getBotGuardVm(globalName)) {
    // Extract interpreter URL from TrustedResourceUrl wrapper
    const interpreterUrlRaw = challengeData.bgChallenge?.interpreterUrl;
    const interpreterUrl =
      typeof interpreterUrlRaw === "string"
        ? interpreterUrlRaw
        : interpreterUrlRaw?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
    if (interpreterUrl) {
      await new Promise<void>((resolve, reject) => {
        const elScript = document.createElement("script");
        elScript.src = new URL(interpreterUrl, location.href).href;
        elScript.onload = () => resolve();
        elScript.onerror = () => reject(new Error("Failed to load BotGuard interpreter"));
        document.head.append(elScript);
      });
    }
  }

  for (let i = 0; i < 60; i++) {
    if (getBotGuardVm(globalName)) {
      break;
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // BotGuard VM shape is fully dynamic - typed just enough to call it
  const botGuardVm = getBotGuardVm(globalName);
  if (!botGuardVm || typeof botGuardVm.a !== "function") {
    throw new Error(`BotGuard VM not found at window.${globalName}`);
  }

  // Step 3: Sync snapshot (async callback doesn't work from content script)
  const webPoSignalOutput = new Array<unknown>();
  const initResult = botGuardVm.a(program, () => {}, true, undefined, () => {}, [[], []]);
  const syncSnapshotFunction = initResult?.[0];
  if (typeof syncSnapshotFunction !== "function") {
    throw new Error("Sync snapshot function not available");
  }

  const snapshotResponse = syncSnapshotFunction.call(
    null, [undefined, undefined, webPoSignalOutput, undefined]
  );
  if (!snapshotResponse) {
    throw new Error("Empty snapshot response");
  }

  // Step 4: Exchange snapshot for integrity token
  const integrityResponse = await fetch(
    "https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateIT",
    {
      method: "POST",
      headers: {
        "content-type": "application/json+protobuf",
        "x-goog-api-key": GOOG_API_KEY,
        "x-user-agent": "grpc-web-javascript/0.1"
      },
      body: JSON.stringify([REQUEST_KEY, snapshotResponse])
    }
  );

  const integrityData = await integrityResponse.json();
  if (!integrityData[0]) {
    throw new Error("No integrity token received");
  }

  // Step 5: Mint PO token
  const signalFunction = webPoSignalOutput[0];
  if (typeof signalFunction !== "function") {
    throw new Error("WebPo signal function not available");
  }

  const mintFunction = await signalFunction(new TextEncoder().encode(integrityData[0]));
  if (typeof mintFunction !== "function") {
    throw new Error("Mint function not available");
  }

  const tokenBytes = await mintFunction(new TextEncoder().encode(videoId));
  return btoa(String.fromCharCode(...tokenBytes));
}

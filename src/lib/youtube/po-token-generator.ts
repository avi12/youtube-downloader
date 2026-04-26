declare const ytcfg: {
  get(key: string): unknown;
} | undefined;

interface ChallengeResponse {
  bgChallenge?: {
    program: string;
    globalName: string;
    interpreterUrl: string | {
      privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: string;
    };
  };
}

export async function generatePoToken({ videoId, clientName = "WEB", clientVersion: clientVersionOverride }: {
  videoId: string;
  clientName?: string;
  clientVersion?: string;
}) {
  function getYtcfgValue({ key, fallback }: {
    key: string;
    fallback: string;
  }) {
    return typeof ytcfg !== "undefined" ? String(ytcfg.get(key) ?? fallback) : fallback;
  }

  const clientVersion = clientVersionOverride ?? getYtcfgValue({
    key: "INNERTUBE_CLIENT_VERSION",
    fallback: "2.20260401.01.00"
  });
  const requestKey = getYtcfgValue({
    key: "BOTGUARD_EXPERIMENT_ID",
    fallback: "O43z0dpjhgX20SCx4KAo"
  });
  // INNERTUBE_API_KEY from ytcfg doesn't have Web Anti-Abuse API enabled;
  // this hardcoded YouTube web key is what YouTube's own BotGuard uses.
  const waaApiKey = "AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw";

  const challengeResponse = await fetch(
    "https://www.youtube.com/youtubei/v1/att/get?prettyPrint=false",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        engagementType: "ENGAGEMENT_TYPE_UNBOUND",
        context: {
          client: {
            clientName,
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

  // On non-watch pages (subscriptions, homepage) BotGuard isn't pre-loaded, so load the interpreter ourselves.
  function getBotGuardVm(name: string) {
    const entry = Object.getOwnPropertyDescriptor(globalThis, name)?.value;
    return entry !== null && typeof entry === "object" && "a" in entry ? entry : null;
  }

  if (!getBotGuardVm(globalName)) {
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

  for (let attempt = 0; attempt < 60; attempt++) {
    if (getBotGuardVm(globalName)) {
      break;
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const botGuardVm = getBotGuardVm(globalName);
  if (!botGuardVm || typeof botGuardVm.a !== "function") {
    throw new Error(`BotGuard VM not found at window.${globalName}`);
  }

  type SnapshotFn = (inputs: unknown[]) => string | null;
  type BotGuardResult = [SnapshotFn?];
  type SignalFn = (input: Uint8Array) => Promise<(input: Uint8Array) => Promise<Uint8Array>>;

  const webPoSignalOutput: SignalFn[] = [];

  type BotGuardInitResult = BotGuardResult | null | undefined;
  const initResult: BotGuardInitResult = botGuardVm.a(
    program, () => {}, true, undefined, () => {}, [[], []]
  );
  const snapshotFn = initResult?.[0];
  if (typeof snapshotFn !== "function") {
    throw new Error("BotGuard snapshot function not available");
  }

  const snapshotResponse = snapshotFn.call(null, [undefined, undefined, webPoSignalOutput, undefined]);
  if (!snapshotResponse) {
    throw new Error("Empty snapshot response");
  }

  // Direct jnn-pa.googleapis.com returns 403 from content script context; the youtube.com proxy endpoint succeeds.
  const integrityResponse = await fetch(
    "https://www.youtube.com/api/jnn/v1/GenerateIT",
    {
      method: "POST",
      headers: {
        "content-type": "application/json+protobuf",
        "x-goog-api-key": waaApiKey
      },
      body: JSON.stringify([requestKey, snapshotResponse])
    }
  );

  const integrityData = await integrityResponse.json();
  if (!integrityData[0]) {
    throw new Error("No integrity token received");
  }

  // TextEncoder would give UTF-8 bytes of the base64 string, not the actual token bytes.
  const integrityTokenBytes = Uint8Array.from(atob(integrityData[0]), char => char.charCodeAt(0));

  const [signalFunction] = webPoSignalOutput;
  if (typeof signalFunction !== "function") {
    throw new Error("WebPo signal function not available");
  }

  const mintFunction = await signalFunction(integrityTokenBytes);
  if (typeof mintFunction !== "function") {
    throw new Error("Mint function not available");
  }

  const tokenBytes = await mintFunction(new TextEncoder().encode(videoId));
  const SABR_TOKEN_BYTE_LENGTH = 30;
  const initialToken = btoa(String.fromCharCode(...tokenBytes.slice(0, SABR_TOKEN_BYTE_LENGTH)));
  cacheMintFunction(videoId, mintFunction);
  return initialToken;
}

type MintFunction = (input: Uint8Array) => Promise<Uint8Array>;

const mintFunctionsByVideoId = new Map<string, MintFunction>();

function cacheMintFunction(videoId: string, mintFunction: MintFunction) {
  mintFunctionsByVideoId.set(videoId, mintFunction);
}

// YouTube rotates its accepted attestation after a few SABR segments; long
// downloads call this to re-mint against the cached BotGuard snapshot.
export async function refreshPoToken(videoId: string) {
  const mintFunction = mintFunctionsByVideoId.get(videoId);
  if (!mintFunction) {
    return null;
  }

  const tokenBytes = await mintFunction(new TextEncoder().encode(videoId));
  const SABR_TOKEN_BYTE_LENGTH = 30;
  return btoa(String.fromCharCode(...tokenBytes.slice(0, SABR_TOKEN_BYTE_LENGTH)));
}

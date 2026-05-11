import {
  InnertubeClientName,
  InnertubeEngagementType,
  type InnertubeAttGetRequest,
  type InnertubeGenerateItRequest,
  type InnertubeGenerateItResponse
} from "./innertube";
import { getYtcfg, YtcfgKey } from "./ytcfg";

interface ChallengeResponse {
  bgChallenge?: {
    program: string;
    globalName: string;
    interpreterUrl: string | {
      privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: string;
    };
  };
}

export async function generatePoToken(videoId: string) {
  const clientVersion = getYtcfg(YtcfgKey.ClientVersion) ?? "2.20260401.01.00";
  const requestKey = getYtcfg(YtcfgKey.BotguardExperimentId) ?? "O43z0dpjhgX20SCx4KAo";
  // INNERTUBE_API_KEY from ytcfg doesn't have Web Anti-Abuse API enabled;
  // this hardcoded YouTube web key is what YouTube's own BotGuard uses.
  const waaApiKey = "AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw";

  const challengeResponse = await fetch("https://www.youtube.com/youtubei/v1/att/get?prettyPrint=false", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      engagementType: InnertubeEngagementType.Unbound,
      context: {
        client: {
          clientName: InnertubeClientName.Web,
          clientVersion
        }
      }
    } satisfies InnertubeAttGetRequest)
  });

  const challengeData: ChallengeResponse = await challengeResponse.json();
  const { program, globalName, interpreterUrl: interpreterUrlRaw } = challengeData.bgChallenge ?? {};
  if (!program || !globalName) {
    throw new Error("No BotGuard challenge data received");
  }

  // On non-watch pages (subscriptions, homepage) BotGuard isn't pre-loaded, so load the interpreter ourselves.
  function getBotGuardVm(name: string) {
    const globals: Record<string, unknown> = globalThis;
    const { [name]: entry } = globals;
    return typeof entry === "object" && entry !== null && "a" in entry ? entry : null;
  }

  if (!getBotGuardVm(globalName)) {
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

  const VM_POLL_INTERVAL_MS = 500;
  const VM_POLL_MAX_ATTEMPTS = 60;
  for (let attempt = 0; attempt < VM_POLL_MAX_ATTEMPTS; attempt++) {
    if (getBotGuardVm(globalName)) {
      break;
    }

    await new Promise(resolve => setTimeout(resolve, VM_POLL_INTERVAL_MS));
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
      body: JSON.stringify([requestKey, snapshotResponse] satisfies InnertubeGenerateItRequest)
    }
  );

  const integrityData: InnertubeGenerateItResponse = await integrityResponse.json();
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
  return btoa(String.fromCharCode(...tokenBytes));
}

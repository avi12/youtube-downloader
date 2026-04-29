import { fetchIntegrityToken, getBotGuardVm, loadBotGuardInterpreter, waitForBotGuardVm } from "./botguard-vm";

declare const ytcfg: { get(key: string): unknown } | undefined;

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

  const challengeResponse = await fetch("https://www.youtube.com/youtubei/v1/att/get?prettyPrint=false", {
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
  });

  const challengeData: ChallengeResponse = await challengeResponse.json();
  const program = challengeData.bgChallenge?.program;
  const globalName = challengeData.bgChallenge?.globalName;
  if (!program || !globalName) {
    throw new Error("No BotGuard challenge data received");
  }

  if (!getBotGuardVm(globalName)) {
    const interpreterUrlRaw = challengeData.bgChallenge?.interpreterUrl;
    const interpreterUrl = typeof interpreterUrlRaw === "string"
      ? interpreterUrlRaw
      : interpreterUrlRaw?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
    if (interpreterUrl) {
      await loadBotGuardInterpreter(interpreterUrl);
    }
  }

  await waitForBotGuardVm(globalName);

  const botGuardVm = getBotGuardVm(globalName);
  if (!botGuardVm || typeof botGuardVm.a !== "function") {
    throw new Error(`BotGuard VM not found at window.${globalName}`);
  }

  const webPoSignalOutput: [((input: Uint8Array) => Promise<(input: Uint8Array) => Promise<Uint8Array>>)?] = [];
  const initResult = botGuardVm.a(program, () => {}, true, undefined, () => {}, [[], []]);
  const syncSnapshotFunction = initResult?.[0];
  if (typeof syncSnapshotFunction !== "function") {
    throw new Error("Sync snapshot function not available");
  }

  const snapshotResponse = syncSnapshotFunction.call(null, [undefined, undefined, webPoSignalOutput, undefined]);
  if (!snapshotResponse) {
    throw new Error("Empty snapshot response");
  }

  const integrityToken = await fetchIntegrityToken(requestKey, snapshotResponse);
  const signalFunction = webPoSignalOutput[0];
  if (typeof signalFunction !== "function") {
    throw new Error("WebPo signal function not available");
  }

  const integrityTokenBytes = Uint8Array.from(atob(integrityToken), char => char.charCodeAt(0));
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

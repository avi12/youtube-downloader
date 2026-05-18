import { ensureBotGuardVm, getBotGuardVm, initBotGuardVm } from "./botguard-vm";
import type { SignalFunction } from "./botguard-vm";
import {
  InnertubeClientName,
  InnertubeEngagementType,
  type InnertubeAttGetRequest,
  type InnertubeGenerateItRequest,
  type InnertubeGenerateItResponse
} from "./innertube";
import { getYtcfg, YtcfgKey } from "./ytcfg";
import { base64ToUint8Array } from "@/lib/utils/binary";

interface ChallengeResponse {
  bgChallenge?: {
    program: string;
    globalName: string;
    interpreterUrl: string | {
      privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: string;
    };
  };
}

const WAA_API_KEY = "AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw";

export async function generatePoToken(videoId: string) {
  const clientVersion = getYtcfg(YtcfgKey.ClientVersion) ?? "2.20260401.01.00";
  const requestKey = getYtcfg(YtcfgKey.BotguardExperimentId) ?? "O43z0dpjhgX20SCx4KAo";

  const attGetRequest: InnertubeAttGetRequest = {
    engagementType: InnertubeEngagementType.Unbound,
    context: {
      client: {
        clientName: InnertubeClientName.Web,
        clientVersion
      }
    }
  };
  const challengeResponse = await fetch("https://www.youtube.com/youtubei/v1/att/get?prettyPrint=false", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(attGetRequest)
  });

  const challengeData: ChallengeResponse = await challengeResponse.json();
  const { program, globalName, interpreterUrl: interpreterUrlRaw } = challengeData.bgChallenge ?? {};
  const isChallengeDataMissing = !program || !globalName;
  if (isChallengeDataMissing) {
    throw new Error("No BotGuard challenge data received");
  }

  await ensureBotGuardVm({
    globalName,
    interpreterUrlRaw
  });

  const botGuardVm = getBotGuardVm(globalName);
  if (!botGuardVm) {
    throw new Error(`BotGuard VM not found at window.${globalName}`);
  }

  const webPoSignalOutput: SignalFunction[] = [];
  const snapshotResponse = initBotGuardVm({
    botGuardEntry: botGuardVm,
    program,
    webPoSignalOutput
  });

  const generateItRequest: InnertubeGenerateItRequest = [requestKey, snapshotResponse];
  const integrityResponse = await fetch("https://www.youtube.com/api/jnn/v1/GenerateIT", {
    method: "POST",
    headers: {
      "content-type": "application/json+protobuf",
      "x-goog-api-key": WAA_API_KEY
    },
    body: JSON.stringify(generateItRequest)
  });

  const integrityData: InnertubeGenerateItResponse = await integrityResponse.json();
  const isIntegrityTokenMissing = !integrityData[0];
  if (isIntegrityTokenMissing) {
    throw new Error("No integrity token received");
  }

  const integrityTokenBytes = base64ToUint8Array(integrityData[0]);

  const [signalFunction] = webPoSignalOutput;
  const isSignalFunctionMissing = typeof signalFunction !== "function";
  if (isSignalFunctionMissing) {
    throw new Error("WebPo signal function not available");
  }

  const mintFunction = await signalFunction(integrityTokenBytes);
  const isMintFunctionMissing = typeof mintFunction !== "function";
  if (isMintFunctionMissing) {
    throw new Error("Mint function not available");
  }

  const tokenBytes = await mintFunction(new TextEncoder().encode(videoId));
  const SABR_PO_TOKEN_BYTES = 30;
  return btoa(String.fromCharCode(...tokenBytes.slice(0, SABR_PO_TOKEN_BYTES)));
}

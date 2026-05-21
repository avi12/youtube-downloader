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
const ATT_GET_URL = "https://www.youtube.com/youtubei/v1/att/get?prettyPrint=false";
const GENERATE_IT_URL = "https://www.youtube.com/api/jnn/v1/GenerateIT";
const CONTENT_TYPE_JSON = "application/json";
const CONTENT_TYPE_JSON_PROTOBUF = "application/json+protobuf";
const HEADER_X_GOOG_API_KEY = "x-goog-api-key";
const DEFAULT_CLIENT_VERSION = "2.20260401.01.00";
const DEFAULT_REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";

export async function generatePoToken(videoId: string) {
  const clientVersion = getYtcfg(YtcfgKey.ClientVersion) ?? DEFAULT_CLIENT_VERSION;
  const requestKey = getYtcfg(YtcfgKey.BotguardExperimentId) ?? DEFAULT_REQUEST_KEY;

  const attGetRequest: InnertubeAttGetRequest = {
    engagementType: InnertubeEngagementType.Unbound,
    context: {
      client: {
        clientName: InnertubeClientName.Web,
        clientVersion
      }
    }
  };
  const challengeResponse = await fetch(ATT_GET_URL, {
    method: "POST",
    headers: {
      "Content-Type": CONTENT_TYPE_JSON
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
  const isBotGuardVmMissing = !botGuardVm;
  if (isBotGuardVmMissing) {
    throw new Error(`BotGuard VM not found at window.${globalName}`);
  }

  const webPoSignalOutput: SignalFunction[] = [];
  const snapshotResponse = initBotGuardVm({
    botGuardEntry: botGuardVm,
    program,
    webPoSignalOutput
  });

  const generateItRequest: InnertubeGenerateItRequest = [requestKey, snapshotResponse];
  const integrityResponse = await fetch(GENERATE_IT_URL, {
    method: "POST",
    headers: {
      "content-type": CONTENT_TYPE_JSON_PROTOBUF,
      [HEADER_X_GOOG_API_KEY]: WAA_API_KEY
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
  return btoa(String.fromCharCode(...tokenBytes));
}

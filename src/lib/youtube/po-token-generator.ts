import { ensureBotGuardVm, getBotGuardVm, initBotGuardVm } from "./botguard-vm";
import type { SignalFn } from "./botguard-vm";
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

  await ensureBotGuardVm(globalName, interpreterUrlRaw);

  const botGuardVm = getBotGuardVm(globalName);
  if (!botGuardVm) {
    throw new Error(`BotGuard VM not found at window.${globalName}`);
  }

  const webPoSignalOutput: SignalFn[] = [];
  const snapshotResponse = initBotGuardVm(botGuardVm, program, webPoSignalOutput);

  const integrityResponse = await fetch("https://www.youtube.com/api/jnn/v1/GenerateIT", {
    method: "POST",
    headers: {
      "content-type": "application/json+protobuf",
      "x-goog-api-key": WAA_API_KEY
    },
    body: JSON.stringify([requestKey, snapshotResponse] satisfies InnertubeGenerateItRequest)
  });

  const integrityData: InnertubeGenerateItResponse = await integrityResponse.json();
  if (!integrityData[0]) {
    throw new Error("No integrity token received");
  }

  const integrityTokenBytes = base64ToUint8Array(integrityData[0]);

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

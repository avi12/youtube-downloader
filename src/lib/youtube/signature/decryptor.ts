import { extractTransformOperations, findSignatureFunctionName } from "./parser";
import { applyTransforms, type TransformOp } from "./transform";

interface DecryptorState {
  operations: TransformOp[];
  playerJsUrl: string;
}

let cachedState: DecryptorState | null = null;

function getPlayerJsUrl() {
  const scripts = document.querySelectorAll<HTMLScriptElement>("script[src*='/player/']");

  for (const script of scripts) {
    if (/player_ias|base\.js/.test(script.src)) {
      return script.src;
    }
  }

  const pageSource = document.documentElement.innerHTML;
  const playerMatch = pageSource.match(/"(\/s\/player\/[^"]+\/base\.js)"/);
  if (playerMatch) {
    return `https://www.youtube.com${playerMatch[1]}`;
  }

  return null;
}

async function initDecryptor() {
  const playerJsUrl = getPlayerJsUrl();
  if (!playerJsUrl) {
    throw new Error("Could not find player.js URL");
  }

  if (cachedState?.playerJsUrl === playerJsUrl) {
    return cachedState;
  }

  const response = await fetch(playerJsUrl);
  const playerSource = await response.text();

  const functionName = findSignatureFunctionName(playerSource);
  if (!functionName) {
    throw new Error("Could not find signature function name in player.js");
  }

  const operations = extractTransformOperations({
    playerSource,
    functionName
  });
  if (!operations) {
    throw new Error("Could not extract transform operations from player.js");
  }

  cachedState = {
    operations,
    playerJsUrl
  };
  return cachedState;
}

export async function decryptSignatureCipher(signatureCipher: string) {
  const params = new URLSearchParams(signatureCipher);
  const encryptedSig = params.get("s");
  const sigParam = params.get("sp") ?? "sig";
  const url = params.get("url");
  if (!encryptedSig || !url) {
    throw new Error("Invalid signatureCipher format");
  }

  const { operations } = await initDecryptor();
  const decryptedSig = applyTransforms({
    signature: decodeURIComponent(encryptedSig),
    operations
  });
  const resultUrl = new URL(decodeURIComponent(url));
  resultUrl.searchParams.set(sigParam, decryptedSig);
  return resultUrl.href;
}

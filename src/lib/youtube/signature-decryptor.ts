import { applyTransforms, findAndExtractOperations } from "./signature-parser";
import type { TransformOp } from "./signature-parser";

interface DecryptorState {
  operations: TransformOp[];
  playerJsUrl: string;
}

let cachedState: DecryptorState | null = null;

function getPlayerJsUrl() {
  const elScripts = document.querySelectorAll<HTMLScriptElement>("script[src*='/player/']");

  for (const elScript of elScripts) {
    if (/player_ias|base\.js/.test(elScript.src)) {
      return elScript.src;
    }
  }

  const pageSource = document.documentElement.innerHTML;
  const [, playerPath] = pageSource.match(/"(\/s\/player\/[^"]+\/base\.js)"/) ?? [];
  if (playerPath) {
    return `https://www.youtube.com${playerPath}`;
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

  const operations = findAndExtractOperations(playerSource);
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
  const cipherParameters = new URLSearchParams(signatureCipher);
  const encryptedSig = cipherParameters.get("s");
  const sigParam = cipherParameters.get("sp") ?? "sig";
  const url = cipherParameters.get("url");
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

import { applyTransforms, findAndExtractOperations } from "./signature-parser";
import type { TransformOp } from "./signature-parser";

const DEFAULT_SIG_PARAM = "sig";
const YOUTUBE_BASE_URL = "https://www.youtube.com";

interface DecryptorState {
  operations: TransformOp[];
  playerJsUrl: string;
}

let cachedState: DecryptorState | null = null;

function getPlayerJsUrl() {
  const elScripts = document.querySelectorAll<HTMLScriptElement>("script[src*='/player/']");

  for (const elScript of elScripts) {
    const isPlayerScript = /player_ias|base\.js/.test(elScript.src);
    if (isPlayerScript) {
      return elScript.src;
    }
  }

  const pageSource = document.documentElement.innerHTML;
  const [, playerPath] = pageSource.match(/"(\/s\/player\/[^"]+\/base\.js)"/) ?? [];
  if (playerPath) {
    return `${YOUTUBE_BASE_URL}${playerPath}`;
  }

  return null;
}

async function initDecryptor() {
  const playerJsUrl = getPlayerJsUrl();
  const isPlayerJsMissing = !playerJsUrl;
  if (isPlayerJsMissing) {
    throw new Error("Could not find player.js URL");
  }

  const isCacheValid = cachedState?.playerJsUrl === playerJsUrl;
  if (isCacheValid) {
    return cachedState!;
  }

  const response = await fetch(playerJsUrl);
  const playerSource = await response.text();

  const operations = findAndExtractOperations(playerSource);
  const isOperationsMissing = !operations;
  if (isOperationsMissing) {
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
  const sigParam = cipherParameters.get("sp") ?? DEFAULT_SIG_PARAM;
  const url = cipherParameters.get("url");
  const isCipherInvalid = !encryptedSig || !url;
  if (isCipherInvalid) {
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

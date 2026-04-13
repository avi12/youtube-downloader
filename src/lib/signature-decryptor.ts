type TransformOp = {
  type: "swap";
  argument: number;
}
  | {
    type: "reverse";
  }
  | {
    type: "splice";
    argument: number;
  };

interface DecryptorState {
  operations: TransformOp[];
  playerJsUrl: string;
}

let cachedState: DecryptorState | null = null;

// Match where the decrypted signature is passed to a URL parameter setter in player.js.
const FUNCTION_NAME_PATTERNS = [
  /\b[cs]\s*&&\s*[adf]\.set\([^,]+\s*,\s*encodeURIComponent\(([a-zA-Z0-9$]+)\(/,
  /\bm=([a-zA-Z0-9$]{2,})\(decodeURIComponent\(h\.s\)\)/,
  /\bc\s*&&\s*d\.set\([^,]+\s*,\s*(?:encodeURIComponent\s*\()([a-zA-Z0-9$]+)\(/,
  /\bc\s*&&\s*[a-z]\.set\([^,]+\s*,\s*([a-zA-Z0-9$]+)\(/,
  /\bc\s*&&\s*[a-z]\.set\([^,]+\s*,\s*encodeURIComponent\(([a-zA-Z0-9$]+)\(/
];

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findSignatureFunctionName(playerSource: string) {
  for (const pattern of FUNCTION_NAME_PATTERNS) {
    const match = playerSource.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function extractTransformOperations(playerSource: string, functionName: string) {
  const escapedName = escapeRegExp(functionName);
  const functionPattern = new RegExp(`(?:var\\s+${escapedName}|${escapedName}\\s*=\\s*function)\\s*=?\\s*function\\s*\\(([a-zA-Z])\\)\\s*\\{([^}]+)\\}`);
  const functionMatch = playerSource.match(functionPattern);
  if (!functionMatch) {
    return null;
  }

  const functionBody = functionMatch[2];

  const helperMatch = functionBody.match(/([a-zA-Z0-9$]+)\.[a-zA-Z0-9$]+\(/);
  if (!helperMatch) {
    return null;
  }

  const helperName = helperMatch[1];

  const escapedHelper = escapeRegExp(helperName);
  const helperPattern = new RegExp(`var\\s+${escapedHelper}\\s*=\\s*\\{([\\s\\S]*?)\\};`);
  const helperObjMatch = playerSource.match(helperPattern);
  if (!helperObjMatch) {
    return null;
  }

  const helperBody = helperObjMatch[1];

  const methodTypes = new Map<string, "swap" | "reverse" | "splice">();

  const methodPattern = /([a-zA-Z0-9$]+)\s*:\s*function\s*\([^)]*\)\s*\{([^}]+)\}/g;
  let methodMatch;

  while ((methodMatch = methodPattern.exec(helperBody)) !== null) {
    const methodName = methodMatch[1];
    const methodBody = methodMatch[2];
    if (methodBody.includes("reverse")) {
      methodTypes.set(methodName, "reverse");
    } else if (methodBody.includes("splice")) {
      methodTypes.set(methodName, "splice");
    } else {
      methodTypes.set(methodName, "swap");
    }
  }

  const callPattern = new RegExp(
    `${escapedHelper}\\.([a-zA-Z0-9$]+)\\([^,]+,\\s*(\\d+)\\)`,
    "g"
  );
  const operations: TransformOp[] = [];

  for (const callMatch of functionBody.matchAll(callPattern)) {
    const methodName = callMatch[1];
    const argument = Number.parseInt(callMatch[2], 10);
    const opType = methodTypes.get(methodName);
    if (!opType) {
      continue;
    }

    if (opType === "reverse") {
      operations.push({ type: "reverse" });
    } else {
      operations.push({ type: opType, argument });
    }
  }

  return operations.length > 0 ? operations : null;
}

function applyTransforms(signature: string, operations: TransformOp[]) {
  const characters = signature.split("");

  for (const operation of operations) {
    switch (operation.type) {
      case "reverse":
        characters.reverse();
        break;
      case "splice":
        characters.splice(0, operation.argument);
        break;
      case "swap": {
        const position = operation.argument % characters.length;
        const temp = characters[0];
        characters[0] = characters[position];
        characters[position] = temp;
        break;
      }
    }
  }

  return characters.join("");
}

function getPlayerJsUrl() {
  const scripts = document.querySelectorAll<HTMLScriptElement>("script[src*='/player/']");

  for (const script of scripts) {
    if (script.src.includes("player_ias") || script.src.includes("base.js")) {
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

  const operations = extractTransformOperations(playerSource, functionName);
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
  const decryptedSig = applyTransforms(decodeURIComponent(encryptedSig), operations);
  const resultUrl = new URL(decodeURIComponent(url));
  resultUrl.searchParams.set(sigParam, decryptedSig);
  return resultUrl.href;
}

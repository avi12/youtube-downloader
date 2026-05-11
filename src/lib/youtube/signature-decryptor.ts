const TransformOpType = {
  Swap: "swap",
  Reverse: "reverse",
  Splice: "splice"
} as const;

type TransformOp = {
  type: typeof TransformOpType.Swap;
  argument: number;
}
  | {
    type: typeof TransformOpType.Reverse;
  }
  | {
    type: typeof TransformOpType.Splice;
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
    const [, functionName] = playerSource.match(pattern) ?? [];
    if (functionName) {
      return functionName;
    }
  }

  return null;
}

function extractTransformOperations({ playerSource, functionName }: {
  playerSource: string;
  functionName: string;
}) {
  const escapedName = escapeRegExp(functionName);
  const functionPattern = new RegExp(`(?:var\\s+${escapedName}|${escapedName}\\s*=\\s*function)\\s*=?\\s*function\\s*\\(([a-zA-Z])\\)\\s*\\{([^}]+)\\}`);
  const [, , functionBody] = playerSource.match(functionPattern) ?? [];
  if (!functionBody) {
    return null;
  }

  const [, helperName] = functionBody.match(/([a-zA-Z0-9$]+)\.[a-zA-Z0-9$]+\(/) ?? [];
  if (!helperName) {
    return null;
  }

  const escapedHelper = escapeRegExp(helperName);
  const helperPattern = new RegExp(`var\\s+${escapedHelper}\\s*=\\s*\\{([\\s\\S]*?)\\};`);
  const [, helperBody] = playerSource.match(helperPattern) ?? [];
  if (!helperBody) {
    return null;
  }

  const methodTypes = new Map<string, (typeof TransformOpType)[keyof typeof TransformOpType]>();

  const methodPattern = /([a-zA-Z0-9$]+)\s*:\s*function\s*\([^)]*\)\s*\{([^}]+)}/g;

  for (const [, methodName, methodBody] of helperBody.matchAll(methodPattern)) {
    if (methodBody.includes("reverse")) {
      methodTypes.set(methodName, TransformOpType.Reverse);
    } else if (methodBody.includes("splice")) {
      methodTypes.set(methodName, TransformOpType.Splice);
    } else {
      methodTypes.set(methodName, TransformOpType.Swap);
    }
  }

  const callPattern = new RegExp(
    `${escapedHelper}\\.([a-zA-Z0-9$]+)\\([^,]+,\\s*(\\d+)\\)`,
    "g"
  );
  const operations: TransformOp[] = [];

  for (const [, methodName, rawArgument] of functionBody.matchAll(callPattern)) {
    const argument = Number.parseInt(rawArgument, 10);
    const opType = methodTypes.get(methodName);
    if (!opType) {
      continue;
    }

    if (opType === TransformOpType.Reverse) {
      operations.push({ type: TransformOpType.Reverse });
    } else {
      operations.push({
        type: opType,
        argument
      });
    }
  }

  return operations.length > 0 ? operations : null;
}

function applyTransforms({ signature, operations }: {
  signature: string;
  operations: TransformOp[];
}) {
  const characters = signature.split("");

  for (const operation of operations) {
    switch (operation.type) {
      case TransformOpType.Reverse:
        characters.reverse();
        break;
      case TransformOpType.Splice:
        characters.splice(0, operation.argument);
        break;
      case TransformOpType.Swap: {
        const position = operation.argument % characters.length;
        let firstCode = characters[0].charCodeAt(0);
        let positionCode = characters[position].charCodeAt(0);
        firstCode ^= positionCode;
        positionCode ^= firstCode;
        firstCode ^= positionCode;
        characters[0] = String.fromCharCode(firstCode);
        characters[position] = String.fromCharCode(positionCode);
        break;
      }
    }
  }

  return characters.join("");
}

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

import { TransformOpType, type TransformOp } from "./transform";

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

export function findSignatureFunctionName(playerSource: string) {
  for (const pattern of FUNCTION_NAME_PATTERNS) {
    const match = playerSource.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

export function extractTransformOperations({ playerSource, functionName }: {
  playerSource: string;
  functionName: string;
}) {
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

  const methodTypes = new Map<string, (typeof TransformOpType)[keyof typeof TransformOpType]>();

  const methodPattern = /([a-zA-Z0-9$]+)\s*:\s*function\s*\([^)]*\)\s*\{([^}]+)\}/g;
  let methodMatch;

  while ((methodMatch = methodPattern.exec(helperBody)) !== null) {
    const methodName = methodMatch[1];
    const methodBody = methodMatch[2];
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

  for (const callMatch of functionBody.matchAll(callPattern)) {
    const methodName = callMatch[1];
    const argument = Number.parseInt(callMatch[2], 10);
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

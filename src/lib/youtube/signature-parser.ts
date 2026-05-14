import { TransformOpType } from "./signature-transforms";
import type { TransformOp } from "./signature-transforms";

export { applyTransforms } from "./signature-transforms";
export type { TransformOp } from "./signature-transforms";

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

function extractTransformOperations(playerSource: string, functionName: string) {
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

export function findAndExtractOperations(playerSource: string) {
  const functionName = findSignatureFunctionName(playerSource);
  if (!functionName) {
    return null;
  }

  return extractTransformOperations(playerSource, functionName);
}

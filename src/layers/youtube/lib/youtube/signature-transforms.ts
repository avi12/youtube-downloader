import type { Prettify } from "@/types";

export const TransformOpType = {
  Swap: "swap",
  Reverse: "reverse",
  Splice: "splice"
} as const;

export type TransformOp = {
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

type ApplyTransformsParams = Prettify<{
  signature: string;
  operations: TransformOp[];
}>;
export function applyTransforms({ signature, operations }: ApplyTransformsParams) {
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

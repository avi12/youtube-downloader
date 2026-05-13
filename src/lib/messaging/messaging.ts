import type { ProtocolMap } from "./protocol";
import { defineExtensionMessaging } from "@webext-core/messaging";

export * from "./message-types";
export * from "./protocol-types";
export type { ProtocolMap };

export const { sendMessage, onMessage } =
  defineExtensionMessaging<ProtocolMap>({
    breakError: true
  });

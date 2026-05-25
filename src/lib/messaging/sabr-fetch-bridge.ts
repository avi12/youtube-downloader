import { defineWindowMessaging } from "@webext-core/messaging/page";

export type PageSabrFetchRequest = {
  url: string;
  method: string;
  bodyBase64: string;
  headers?: Record<string, string>;
};

export type PageSabrFetchResponse = {
  status: number;
  bodyBase64: string;
  responseHeaders: Record<string, string>;
} | null;

interface SabrBridgeSchema {
  pageSabrFetch(data: PageSabrFetchRequest): PageSabrFetchResponse;
}

export const sabrFetchBridge = defineWindowMessaging<SabrBridgeSchema>({ namespace: "ytdl-sabr-fetch" });

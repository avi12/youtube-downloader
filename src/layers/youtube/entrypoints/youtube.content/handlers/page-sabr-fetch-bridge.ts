import {
  MessageType,
  onMessage,
  type PageSabrFetchRequest,
  type PageSabrFetchResponse
} from "@/lib/messaging/messaging";
import { sabrFetchBridge } from "@/lib/messaging/sabr-fetch-bridge";

async function handlePageSabrFetch({ data }: { data: PageSabrFetchRequest }): Promise<PageSabrFetchResponse> {
  return sabrFetchBridge.sendMessage("pageSabrFetch", data);
}

export function registerPageSabrFetchBridge() {
  onMessage(MessageType.PageSabrFetch, handlePageSabrFetch);
}

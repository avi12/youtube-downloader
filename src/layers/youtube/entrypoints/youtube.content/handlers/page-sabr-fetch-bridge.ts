import {
  MessageType,
  onMessage,
  type PageSabrFetchRequest
} from "@/lib/messaging/messaging";
import { sabrFetchBridge } from "@/lib/messaging/sabr-fetch-bridge";
import { isPageSabrFetchResponse } from "#youtube/lib/messaging/payload-guards";

async function handlePageSabrFetch({ data }: { data: PageSabrFetchRequest }) {
  const response = await sabrFetchBridge.sendMessage("pageSabrFetch", data);
  return isPageSabrFetchResponse(response) ? response : null;
}

export function registerPageSabrFetchBridge() {
  onMessage(MessageType.PageSabrFetch, handlePageSabrFetch);
}

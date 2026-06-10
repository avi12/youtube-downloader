import type { Prettify } from "@/types";

export let capturedPoToken = "";
export let capturedSabrUrl = "";
export let capturedPoTokenVideoId = "";

type SetPoTokenCredentialsParams = Prettify<{
  poToken: string;
  sabrUrl: string;
  videoId?: string;
}>;
export function setPoTokenCredentials({ poToken, sabrUrl, videoId = "" }: SetPoTokenCredentialsParams) {
  capturedPoToken = poToken;
  capturedSabrUrl = sabrUrl;
  capturedPoTokenVideoId = videoId;
}

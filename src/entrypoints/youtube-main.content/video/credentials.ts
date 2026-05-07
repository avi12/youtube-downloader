export let capturedPoToken = "";
export let capturedSabrUrl = "";
export let capturedPoTokenVideoId = "";

export function setPoTokenCredentials({ poToken, sabrUrl, videoId = "" }: {
  poToken: string;
  sabrUrl: string;
  videoId?: string;
}) {
  capturedPoToken = poToken;
  capturedSabrUrl = sabrUrl;
  capturedPoTokenVideoId = videoId;
}

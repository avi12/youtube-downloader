export let capturedPoToken = "";
export let capturedAlternateClientPoToken = "";
export let capturedSabrUrl = "";
export let capturedPoTokenVideoId = "";

export function setPoTokenCredentials({ poToken, alternateClientPoToken, sabrUrl, videoId = "" }: {
  poToken: string;
  alternateClientPoToken?: string;
  sabrUrl: string;
  videoId?: string;
}) {
  capturedPoToken = poToken;
  capturedAlternateClientPoToken = alternateClientPoToken ?? capturedAlternateClientPoToken;
  capturedSabrUrl = sabrUrl;
  capturedPoTokenVideoId = videoId;
}

export let capturedPoToken = "";
export let capturedSabrUrl = "";
export let capturedPoTokenVideoId = "";

export function setPoTokenCredentials(poToken: string, sabrUrl: string, videoId = "") {
  capturedPoToken = poToken;
  capturedSabrUrl = sabrUrl;
  capturedPoTokenVideoId = videoId;
}

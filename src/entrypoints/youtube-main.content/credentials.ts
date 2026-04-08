export let capturedPoToken = "";
export let capturedSabrUrl = "";

export function setPoTokenCredentials(poToken: string, sabrUrl: string) {
  capturedPoToken = poToken;
  capturedSabrUrl = sabrUrl;
}

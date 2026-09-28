import { capturedPoToken, capturedSabrUrl, setPoTokenCredentials } from "./captured-credentials";
import { sabrCredentials } from "@/lib/ui/synced-stores.svelte";

const CREDENTIAL_POLL_INTERVAL_MS = 200;
const CREDENTIAL_POLL_MAX_WAIT_MS = 5000;
const SABR_CREDENTIALS_ELEMENT_ID = "ytdl-sabr-credentials";

function readDomCredentials() {
  const elCredentials = document.getElementById(SABR_CREDENTIALS_ELEMENT_ID);
  return {
    poToken: elCredentials?.dataset.poToken,
    url: elCredentials?.dataset.url
  };
}

function resolveCredentials() {
  const storeCredentials = sabrCredentials.value;
  const domCredentials = readDomCredentials();

  const poToken = storeCredentials?.poToken || domCredentials.poToken || capturedPoToken;
  const sabrUrl = storeCredentials?.url || domCredentials.url || capturedSabrUrl;

  const haveCredentialsChanged = poToken !== capturedPoToken || sabrUrl !== capturedSabrUrl;
  if (haveCredentialsChanged) {
    setPoTokenCredentials({
      poToken,
      sabrUrl
    });
  }

  return {
    poToken,
    sabrUrl
  };
}

export async function resolveCredentialsWithRetry() {
  const initial = resolveCredentials();
  if (initial.poToken) {
    return initial;
  }

  const deadline = Date.now() + CREDENTIAL_POLL_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise<void>(resolve => setTimeout(resolve, CREDENTIAL_POLL_INTERVAL_MS));
    const result = resolveCredentials();
    if (result.poToken) {
      return result;
    }
  }

  return resolveCredentials();
}

import { capturedPoToken, capturedSabrUrl, setPoTokenCredentials } from "./credentials";
import { sabrCredentials } from "@/lib/ui/synced-stores.svelte";

const CREDENTIAL_POLL_INTERVAL_MS = 200;
const CREDENTIAL_POLL_MAX_WAIT_MS = 5000;

function resolveCredentials() {
  const creds = sabrCredentials.value;
  const elCredentials = document.getElementById("ytdl-sabr-credentials");

  const currentPoToken =
    creds?.poToken ||
    elCredentials?.dataset.poToken ||
    capturedPoToken;

  const currentSabrUrl =
    creds?.url ||
    elCredentials?.dataset.url ||
    capturedSabrUrl;
  const haveCredentialsChanged = currentPoToken !== capturedPoToken || currentSabrUrl !== capturedSabrUrl;
  if (haveCredentialsChanged) {
    setPoTokenCredentials({
      poToken: currentPoToken ?? "",
      sabrUrl: currentSabrUrl ?? ""
    });
  }

  return {
    poToken: currentPoToken,
    sabrUrl: currentSabrUrl
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

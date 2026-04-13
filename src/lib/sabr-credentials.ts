import { MessageType, sendMessage, onMessage } from "./messaging";
import { sabrCredentials } from "./synced-stores.svelte";

let isCredentialsForwarded = false;

async function forwardSabrCredentials() {
  let captured;
  try {
    captured = await sendMessage(MessageType.GetCapturedSabrBody, {});
  } catch {
    // SW is not ready yet; will retry via forwardSabrCredentialsWithRetry.
    return;
  }

  if (!captured?.url) {
    return;
  }

  // Initial SABR handshake has no PO token, so fall back to whatever BotGuard token the MAIN world already synced in.
  const poToken = captured.poToken || sabrCredentials.value?.poToken || "";

  isCredentialsForwarded = true;
  sabrCredentials.value = {
    url: captured.url,
    poToken
  };

  // postMessage may arrive before the MAIN world's listener is ready, so persist in DOM as fallback.
  let elCredentials = document.getElementById("ytdl-sabr-credentials");
  if (!elCredentials) {
    elCredentials = document.createElement("div");
    elCredentials.id = "ytdl-sabr-credentials";
    elCredentials.hidden = true;
    document.documentElement.append(elCredentials);
  }

  elCredentials.dataset.url = captured.url;
  elCredentials.dataset.poToken = poToken;
}

export async function forwardSabrCredentialsWithRetry() {
  isCredentialsForwarded = false;

  for (let attempt = 0; attempt < 30; attempt++) {
    await forwardSabrCredentials();

    if (isCredentialsForwarded) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

export function listenForSabrBodyReady() {
  onMessage(MessageType.SabrBodyReady, () => {
    void forwardSabrCredentials();
  });
}

/**
 * Forwards SABR credentials (PO token + URL) captured by the background's
 * webRequest listener to the MAIN world via a synced signal.
 *
 * The isolated world writes to sabrCredentials.value, which syncs
 * to the MAIN world via window.postMessage automatically.
 */

import { MessageType, sendMessage, onMessage } from "./messaging";
import { sabrCredentials } from "./synced-stores.svelte";

let isCredentialsForwarded = false;

async function forwardSabrCredentials() {
  const captured = await sendMessage(MessageType.GetCapturedSabrBody, {});
  if (!captured?.poToken) {
    return;
  }

  isCredentialsForwarded = true;
  sabrCredentials.value = { url: captured.url, poToken: captured.poToken };

  // Also persist in DOM as fallback - the postMessage may arrive
  // before the MAIN world's listener is ready
  let elCredentials = document.getElementById("ytdl-sabr-credentials");
  if (!elCredentials) {
    elCredentials = document.createElement("div");
    elCredentials.id = "ytdl-sabr-credentials";
    elCredentials.hidden = true;
    document.documentElement.append(elCredentials);
  }

  elCredentials.dataset.url = captured.url;
  elCredentials.dataset.poToken = captured.poToken;
}

export async function forwardSabrCredentialsWithRetry() {
  isCredentialsForwarded = false;

  for (let iAttempt = 0; iAttempt < 30; iAttempt++) {
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

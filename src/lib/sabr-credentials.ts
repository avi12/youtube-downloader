/**
 * Forwards SABR credentials (PO token + URL) captured by the background's
 * webRequest listener to the MAIN world via a hidden DOM element.
 *
 * CustomEvents don't reliably cross Chrome's isolated/MAIN world boundary,
 * so we use a shared DOM element (#ytdl-sabr-credentials) instead.
 */

import { sendMessage, onMessage } from "./messaging";

let isCredentialsForwarded = false;

async function forwardSabrCredentials() {
  const captured = await sendMessage("getCapturedSabrBody", {});
  if (!captured?.poToken) {
    return;
  }

  isCredentialsForwarded = true;

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
  onMessage("sabrBodyReady", () => {
    forwardSabrCredentials();
  });
}

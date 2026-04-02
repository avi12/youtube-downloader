/**
 * Forwards SABR credentials (PO token + URL) captured by the background's
 * webRequest listener to the MAIN world via a synced signal.
 *
 * The isolated world writes to sabrCredentials.value, which syncs
 * to the MAIN world via window.postMessage automatically.
 */

import { sendMessage, onMessage } from "./messaging";
import { sabrCredentials } from "./synced-stores";

let isCredentialsForwarded = false;

async function forwardSabrCredentials() {
  const captured = await sendMessage("getCapturedSabrBody", {});
  if (!captured?.poToken) {
    return;
  }

  isCredentialsForwarded = true;
  sabrCredentials.value = { url: captured.url, poToken: captured.poToken };
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

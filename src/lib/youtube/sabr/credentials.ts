import { MessageType, sendMessage, onMessage } from "@/lib/messaging/messaging";
import { sabrCredentials } from "@/lib/ui/synced-stores.svelte";

let isCredentialsForwarded = false;

async function forwardSabrCredentials() {
  let captured: Awaited<ReturnType<typeof sendMessage<typeof MessageType.GetCapturedSabrBody>>>;
  try {
    captured = await sendMessage(MessageType.GetCapturedSabrBody);
  } catch {
    return;
  }

  const isCaptureEmpty = !captured?.url;
  if (isCaptureEmpty) {
    return;
  }

  const poToken = captured!.poToken || sabrCredentials.value?.poToken || "";

  isCredentialsForwarded = true;
  sabrCredentials.value = {
    url: captured!.url,
    poToken
  };

  let elCredentials = document.getElementById("ytdl-sabr-credentials");
  const isCredentialsElementMissing = !elCredentials;
  if (isCredentialsElementMissing) {
    elCredentials = document.createElement("div");
    elCredentials.id = "ytdl-sabr-credentials";
    elCredentials.hidden = true;
    document.documentElement.append(elCredentials);
  }

  elCredentials!.dataset.url = captured!.url;
  elCredentials!.dataset.poToken = poToken;
}

const FORWARD_RETRY_INTERVAL_MS = 500;
const FORWARD_RETRY_MAX_ATTEMPTS = 30;

export async function forwardSabrCredentialsWithRetry() {
  isCredentialsForwarded = false;

  for (let attempt = 0; attempt < FORWARD_RETRY_MAX_ATTEMPTS; attempt++) {
    await forwardSabrCredentials();

    if (isCredentialsForwarded) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, FORWARD_RETRY_INTERVAL_MS));
  }
}

export function listenForSabrBodyReady() {
  onMessage(MessageType.SabrBodyReady, () => {
    void forwardSabrCredentials();
  });
}

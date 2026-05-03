import { removeHostedIframe, spawnHostedIframe } from "../iframe-host/iframe-host";
import { waitForPrimerCapture } from "./primer-capture";
import { ScrubUrlParam } from "@/lib/youtube/youtube-url";

const PRIMER_TIMEOUT_MS = 30_000;

export async function primeViaSabrOffscreen(videoId: string): Promise<{
  url: string;
  bodyBase64: string;
} | null> {
  const factoryId = `sabr-primer-${videoId}`;
  await spawnHostedIframe({
    id: factoryId,
    url: `https://www.youtube.com/watch?v=${videoId}&autoplay=1&mute=1&${ScrubUrlParam.TrustFactoryMode}=1&${ScrubUrlParam.FactoryId}=${factoryId}`
  });
  const result = await waitForPrimerCapture(factoryId, PRIMER_TIMEOUT_MS);
  removeHostedIframe(factoryId);
  return result;
}

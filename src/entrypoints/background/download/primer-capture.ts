import { base64ToUint8Array } from "@/lib/utils/binary";
import { setOffscreenCapture } from "@/lib/youtube/sabr/request-capture";

type PrimerResult = {
  url: string;
  bodyBase64: string;
};

const primerResolvers = new Map<string, (result: PrimerResult | null) => void>();

export function waitForPrimerCapture(factoryId: string, timeoutMs: number): Promise<PrimerResult | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      primerResolvers.delete(factoryId);
      resolve(null);
    }, timeoutMs);
    primerResolvers.set(factoryId, result => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

export function resolvePrimerCapture(factoryId: string, url: string, bodyBase64: string) {
  setOffscreenCapture(Array.from(base64ToUint8Array(bodyBase64)), url);
  const resolve = primerResolvers.get(factoryId);
  if (resolve) {
    primerResolvers.delete(factoryId);
    resolve({
      url,
      bodyBase64
    });
  }
}

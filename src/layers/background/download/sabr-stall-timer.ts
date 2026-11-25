// YouTube pauses fast downloads partway: single responses have taken 18s and still completed
const SABR_STALL_TIMEOUT_MS = 30_000;
const SABR_FIRST_BYTE_TIMEOUT_MS = 5_000;

export function createSabrStallTimer(parentSignal: AbortSignal) {
  const controller = new AbortController();
  let timeoutId = setTimeout(() => controller.abort(), SABR_FIRST_BYTE_TIMEOUT_MS);
  parentSignal.addEventListener("abort", () => controller.abort(), { once: true });

  function onProgress() {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => controller.abort(), SABR_STALL_TIMEOUT_MS);
  }

  function cleanup() {
    clearTimeout(timeoutId);
  }

  return {
    signal: controller.signal,
    onProgress,
    cleanup
  };
}
